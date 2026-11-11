//! Stable passkey identity, with a revision fence for account data mutations.
//! Capture once at admission, then check in the SAME IMMEDIATE transaction
//! that writes. Never refresh a captured token after provider work or a wait.
use rusqlite::{Connection, OptionalExtension};

pub(crate) fn schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS account_revisions (
            user TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 0));",
    )
}

pub(crate) fn current(c: &Connection, user: &str) -> rusqlite::Result<u64> {
    c.query_row(
        "SELECT revision FROM account_revisions WHERE user=?",
        [user],
        |row| row.get(0),
    )
    .optional()
    .map(|revision| revision.unwrap_or(0))
}

// Enable this module with the mutation-route integration, before adding reset.
#[cfg(test)]
mod guard {
    use super::*;
    use axum::{
        http::{HeaderMap, StatusCode},
        response::{IntoResponse, Response},
        Json,
    };
    use serde_json::json;

    pub(crate) const REVISION_HEADER: &str = "x-account-revision";
    pub(crate) const USER_HEADER: &str = "x-account-user";

    #[derive(Debug, PartialEq, Eq)]
    pub(crate) enum Error {
        Changed,
        Invalid,
        Unavailable,
    }
    impl From<rusqlite::Error> for Error {
        fn from(_: rusqlite::Error) -> Self {
            Self::Unavailable
        }
    }
    impl Error {
        pub(crate) fn response(self) -> Response {
            let (status, code, error) = match self {
                Self::Changed => (
                    StatusCode::CONFLICT,
                    "account_reset",
                    "Your account changed. Reload before continuing.",
                ),
                Self::Invalid => (
                    StatusCode::BAD_REQUEST,
                    "invalid_account_revision",
                    "Send one account revision and account user.",
                ),
                Self::Unavailable => (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "account_unavailable",
                    "Your account needs another try.",
                ),
            };
            (
                status,
                [(axum::http::header::CACHE_CONTROL, "no-store")],
                Json(json!({"ok":false,"code":code,"error":error})),
            )
                .into_response()
        }
    }

    /// The authenticated user is supplied by the caller, never trusted from a header.
    #[derive(Clone, Debug)]
    pub(crate) struct Revision {
        pub(crate) user: String,
        pub(crate) epoch: u64,
    }
    impl Revision {
        pub(crate) fn capture(
            c: &Connection,
            authenticated_user: &str,
            headers: &HeaderMap,
        ) -> Result<Self, Error> {
            let epoch = current(c, authenticated_user)?;
            let revision = single(headers, REVISION_HEADER)?;
            let user = single(headers, USER_HEADER)?;
            // Old clients work until this account has actually reset. A new cookie
            // cannot silently authorize an old tab's stale save after that reset.
            if revision.is_none() && user.is_none() && epoch == 0 {
                return Ok(Self {
                    user: authenticated_user.into(),
                    epoch,
                });
            }
            let parsed = revision
                .map(|value| {
                    let n = value.parse::<u64>().map_err(|_| Error::Invalid)?;
                    if n.to_string() != value {
                        return Err(Error::Invalid);
                    }
                    Ok(n)
                })
                .transpose()?;
            if parsed != Some(epoch) || user != Some(authenticated_user) {
                return Err(Error::Changed);
            }
            Ok(Self {
                user: authenticated_user.into(),
                epoch,
            })
        }

        /// Call after BEGIN IMMEDIATE, before any write, including private file IO.
        /// A separate read before beginning the transaction is NOT a fence.
        pub(crate) fn check(&self, transaction: &rusqlite::Transaction<'_>) -> Result<(), Error> {
            if current(transaction, &self.user)? != self.epoch {
                return Err(Error::Changed);
            }
            Ok(())
        }
    }

    fn single<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a str>, Error> {
        let mut values = headers.get_all(name).iter();
        let value = values
            .next()
            .map(|value| value.to_str().map_err(|_| Error::Invalid))
            .transpose()?;
        if values.next().is_some() {
            return Err(Error::Invalid);
        }
        Ok(value)
    }
}

#[cfg(test)]
use guard::*;

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, StatusCode};
    use rusqlite::TransactionBehavior;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        schema(&c).unwrap();
        c
    }
    fn headers(user: &str, revision: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(USER_HEADER, user.parse().unwrap());
        h.insert(REVISION_HEADER, revision.parse().unwrap());
        h
    }
    #[test]
    fn legacy_admission_stops_after_reset_and_identity_is_bound() {
        let c = db();
        assert!(Revision::capture(&c, "ann", &HeaderMap::new()).is_ok());
        c.execute("INSERT INTO account_revisions VALUES('ann',1)", [])
            .unwrap();
        for h in [HeaderMap::new(), headers("ann", "0"), headers("bob", "1")] {
            assert_eq!(
                Revision::capture(&c, "ann", &h).unwrap_err(),
                Error::Changed
            );
        }
        assert_eq!(
            Revision::capture(&c, "ann", &headers("ann", "1"))
                .unwrap()
                .epoch,
            1
        );
        assert!(Revision::capture(&c, "bob", &HeaderMap::new()).is_ok());
    }
    #[test]
    fn duplicate_noncanonical_or_partial_headers_are_not_accepted() {
        let c = db();
        for value in ["", "-1", "01", "1.0", "18446744073709551616"] {
            assert_eq!(
                Revision::capture(&c, "ann", &headers("ann", value)).unwrap_err(),
                Error::Invalid
            );
        }
        for name in [USER_HEADER, REVISION_HEADER] {
            let mut h = headers("ann", "0");
            h.append(name, "0".parse().unwrap());
            assert_eq!(
                Revision::capture(&c, "ann", &h).unwrap_err(),
                Error::Invalid
            );
            let mut h = headers("ann", "0");
            h.remove(name);
            assert_eq!(
                Revision::capture(&c, "ann", &h).unwrap_err(),
                Error::Changed
            );
        }
    }
    #[test]
    fn admitted_work_cannot_write_after_reset_commits() {
        let mut c = db();
        let admitted = Revision::capture(&c, "ann", &HeaderMap::new()).unwrap();
        {
            let tx = c
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            tx.execute("INSERT INTO account_revisions VALUES('ann',1)", [])
                .unwrap();
            tx.commit().unwrap();
        }
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        assert_eq!(admitted.check(&tx), Err(Error::Changed));
        let fresh = Revision::capture(&tx, "ann", &headers("ann", "1")).unwrap();
        assert!(fresh.check(&tx).is_ok());
    }
    #[test]
    fn rolled_back_reset_does_not_invalidate_admitted_work() {
        let mut c = db();
        let admitted = Revision::capture(&c, "ann", &HeaderMap::new()).unwrap();
        {
            let tx = c
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            tx.execute("INSERT INTO account_revisions VALUES('ann',1)", [])
                .unwrap();
        }
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        assert!(admitted.check(&tx).is_ok());
    }
    #[test]
    fn revision_survives_reopen_and_fences_a_different_connection() {
        let path =
            std::env::temp_dir().join(format!("account-revision-{}.sqlite", crate::random_hex(12)));
        let mut reader = Connection::open(&path).unwrap();
        schema(&reader).unwrap();
        let admitted = Revision::capture(&reader, "ann", &HeaderMap::new()).unwrap();
        {
            let mut writer = Connection::open(&path).unwrap();
            let tx = writer
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            tx.execute("INSERT INTO account_revisions VALUES('ann',1)", [])
                .unwrap();
            tx.commit().unwrap();
        }
        let tx = reader
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        assert_eq!(admitted.check(&tx), Err(Error::Changed));
        tx.rollback().unwrap();
        drop(reader);
        let reopened = Connection::open(&path).unwrap();
        schema(&reopened).unwrap();
        assert_eq!(current(&reopened, "ann").unwrap(), 1);
        assert_eq!(current(&reopened, "bob").unwrap(), 0);
        drop(reopened);
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn stale_revision_has_a_stable_no_store_response() {
        let response = Error::Changed.response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], "account_reset");
        assert_eq!(body["ok"], false);
    }
}
