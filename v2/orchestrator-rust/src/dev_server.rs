use reqwest::Client;
use serde_json::Value;
use std::{
    env, fs, io,
    io::{Read, Write},
    net::SocketAddr,
    os::unix::{
        fs::{DirBuilderExt, PermissionsExt},
        net::UnixStream,
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::Duration,
};
use tokio::{net::UnixListener, time};

const USAGE: &str = "Usage: cosyworld-orchestrator dev [start|restart|open|status|logs|stop]";

struct Dev {
    address: SocketAddr,
    url: String,
    socket: PathBuf,
    log: PathBuf,
}

pub(super) async fn run(action: &str) -> io::Result<()> {
    if matches!(action, "--help" | "-h" | "help") {
        println!("{USAGE}");
        return Ok(());
    }
    let host = setting("COSYWORLD_V2_HOST", "127.0.0.1");
    let port = setting("COSYWORLD_V2_PORT", "3102");
    let address = format!("{host}:{port}")
        .parse::<SocketAddr>()
        .map_err(io::Error::other)?;
    let dir = PathBuf::from(format!(".runtime/dev-{}", address.port()));
    let dev = Dev {
        address,
        url: setting("COSYWORLD_V2_BASE_URL", &format!("http://{address}")),
        socket: dir.join("control.sock"),
        log: env::var_os("COSYWORLD_V2_LOG")
            .map(PathBuf::from)
            .unwrap_or_else(|| dir.join("server.log")),
    };
    match action {
        "status" => dev.status().await,
        "open" => dev.open(),
        "logs" => {
            if Command::new("tail")
                .arg("-120")
                .arg(&dev.log)
                .status()?
                .success()
            {
                Ok(())
            } else {
                Err(io::Error::other("CosyWorld log is unavailable."))
            }
        }
        "start" | "restart" | "stop" | "__supervise" => {
            fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(&dir)?;
            let metadata = fs::symlink_metadata(&dir)?;
            if !metadata.is_dir() || metadata.permissions().mode() & 0o077 != 0 {
                return Err(io::Error::other(
                    "The development control directory must be private.",
                ));
            }
            let lock = fs::File::options()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(dev.socket.with_extension(if action == "__supervise" {
                    "owner"
                } else {
                    "lock"
                }))?;
            lock.try_lock().map_err(io::Error::other)?;
            match action {
                "__supervise" => dev.supervise().await,
                "stop" => dev.stop().await,
                _ => dev.start().await,
            }
        }
        _ => Err(io::Error::other(USAGE)),
    }
}

impl Dev {
    async fn start(&self) -> io::Result<()> {
        self.stop().await?;
        drop(std::net::TcpListener::bind(self.address)?);
        let log = fs::File::create(&self.log)?;
        let mut supervisor = Command::new(env::current_exe()?)
            .args(["dev", "__supervise"])
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .process_group(0)
            .spawn()?;
        let client = client()?;
        for _ in 0..80 {
            if supervisor.try_wait()?.is_some() {
                break;
            }
            if self.healthy(&client).await {
                self.open()?;
                return self.status().await;
            }
            time::sleep(Duration::from_millis(250)).await;
        }
        self.stop().await?;
        Err(io::Error::other(format!(
            "CosyWorld did not become ready. See {}.",
            self.log.display()
        )))
    }

    async fn supervise(&self) -> io::Result<()> {
        remove_socket(&self.socket)?;
        let listener = UnixListener::bind(&self.socket)?;
        let _socket = Socket(&self.socket);
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        let binary = env::var_os("COSYWORLD_SMOKE_BINARY")
            .map_or_else(env::current_exe, |path| Ok(path.into()))?;
        let mut server = Server(
            Command::new(binary)
                .env("COSYWORLD_V2_ADDR", self.address.to_string())
                .env("COSYWORLD_DISABLE_CTRL_C_SHUTDOWN", "1")
                .env("COSYWORLD_ENABLE_DEV_RESET", "1")
                .env(
                    "COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS",
                    setting("COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS", "450"),
                )
                .env(
                    "COSYWORLD_MODERATION_TOKEN",
                    setting("COSYWORLD_MODERATION_TOKEN", "dev-moderator-token"),
                )
                .spawn()?,
        );
        loop {
            tokio::select! {
                _ = term.recv() => return server.stop().await,
                connection = listener.accept() => {
                    let (connection, _) = connection?;
                    let mut connection = connection.into_std()?;
                    connection.set_nonblocking(false)?;
                    connection.set_read_timeout(Some(Duration::from_secs(1)))?;
                    let mut byte = [0];
                    if connection.read_exact(&mut byte).is_ok() && byte[0] == b'x' {
                        return server.stop().await;
                    }
                }
                _ = time::sleep(Duration::from_millis(200)) => {
                    if let Some(exit) = server.0.try_wait()? {
                        return Err(io::Error::other(format!("CosyWorld stopped ({exit}).")));
                    }
                }
            }
        }
    }

    async fn stop(&self) -> io::Result<()> {
        match UnixStream::connect(&self.socket) {
            Ok(mut control) => control.write_all(b"x")?,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                ) =>
            {
                return Ok(())
            }
            Err(error) => return Err(error),
        }
        for _ in 0..60 {
            if !self.socket.exists() {
                return Ok(());
            }
            time::sleep(Duration::from_millis(100)).await;
        }
        Err(io::Error::other("The CosyWorld supervisor did not stop."))
    }

    async fn healthy(&self, client: &Client) -> bool {
        let result = async {
            client
                .get(format!("{}/health", self.url))
                .send()
                .await?
                .error_for_status()?
                .json::<Value>()
                .await
        };
        result.await.is_ok_and(|health| health["ok"] == true)
    }

    async fn status(&self) -> io::Result<()> {
        let client = client()?;
        if !self.healthy(&client).await {
            return Err(io::Error::other(format!("not healthy: {}", self.url)));
        }
        println!("healthy: {}", self.url);
        if let Ok(response) = client.get(format!("{}/meta", self.url)).send().await {
            if let Ok(meta) = response.json::<Value>().await {
                println!(
                    "meta: {} {} {} rules={}",
                    meta["service"],
                    meta["version"],
                    meta["deployment"]["profile"],
                    meta["card_game"]["shared_rules_version"]
                );
            }
        }
        Ok(())
    }

    fn open(&self) -> io::Result<()> {
        let url = format!("{}/", self.url);
        #[cfg(target_os = "macos")]
        if Command::new("open").arg(&url).status()?.success() {
            return Ok(());
        }
        println!("{url}");
        Ok(())
    }
}

fn client() -> io::Result<Client> {
    Client::builder()
        .timeout(Duration::from_millis(750))
        .build()
        .map_err(io::Error::other)
}

fn setting(key: &str, default: &str) -> String {
    env::var(key)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default.into())
}

fn remove_socket(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

struct Socket<'a>(&'a Path);

impl Drop for Socket<'_> {
    fn drop(&mut self) {
        let _ = remove_socket(self.0);
    }
}

struct Server(Child);

impl Server {
    async fn stop(&mut self) -> io::Result<()> {
        if self.0.try_wait()?.is_some() {
            return Ok(());
        }
        Command::new("kill")
            .args(["-TERM", &self.0.id().to_string()])
            .status()?;
        for _ in 0..50 {
            if self.0.try_wait()?.is_some() {
                return Ok(());
            }
            time::sleep(Duration::from_millis(100)).await;
        }
        self.0.kill()?;
        self.0.wait()?;
        Ok(())
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
