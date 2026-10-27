// A local-only fixture for checking real audio and card controls with CUA.
import { readFile } from "node:fs/promises";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { addLog, encodeSave } from "../card-game/world.mjs";
import cast from "../card-game/voices.json" with { type: "json" };

const server = createServer();
const serve = server.listeners("request")[0];
server.removeAllListeners("request");
const records = [];
server.on("request", async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const id = Object.hasOwn(cast.voices, url.searchParams.get("voice"))
    ? url.searchParams.get("voice")
    : "vale";
  const voice = cast.voices[id];
  const width = url.searchParams.get("width") === "390" ? 390 : 1440;
  const send = (type, body, status = 200) => {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    res.end(body);
  };
  if (url.pathname === "/fixture") {
    const links = Object.entries(cast.voices)
      .map(
        ([key, value]) =>
          `<a href="/fixture?voice=${key}&width=${width}">${value.name}</a>`,
      )
      .join(" · ");
    return send(
      "text/html",
      `<!doctype html><title>Card voice check</title>
      <style>body{background:#17221c;color:white;font:15px system-ui;margin:15px}a{color:#dacf9a}iframe{display:block;border:0;width:${width}px;height:${width === 390 ? 844 : 900}px;margin-top:15px}</style>
      <p>Local voice check · ${links} · <a href="/fixture?voice=${id}&width=${width === 390 ? 1440 : 390}">${width === 390 ? "Desktop" : "Phone"}</a></p>
      <iframe title="Card voice preview" src="/?voice=${id}&table=voice-fixture-${id}"></iframe>`,
    );
  }
  if (url.pathname === "/fixture-records")
    return send("application/json", JSON.stringify(records));
  if (url.pathname === "/fixture-audio" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks));
    const match = Object.entries(cast.voices).find(
      ([, value]) => request.input_references?.[1]?.text === value.transcript,
    );
    if (
      !match ||
      request.model !== cast.model ||
      request.input !== match[1].transcript ||
      !request.input_references[0].input_audio.data.startsWith(
        "data:audio/mpeg;base64,",
      )
    )
      return send(
        "application/json",
        JSON.stringify({
          error: "Voice fixture received a mismatched request",
        }),
        422,
      );
    records.push({
      speaker: match[0],
      model: request.model,
      text: request.input,
      at: Date.now(),
    });
    return send(
      "audio/mpeg",
      await readFile(new URL(`../card-game/${match[1].file}`, import.meta.url)),
    );
  }
  if (url.pathname === "/fixture-seed.mjs") {
    const world = dispatchShared({ op: "create" }).world;
    world.actors.vale.place = world.actors[id].place;
    world.presentActors = ["vale", "mara"];
    world.turn = 1;
    world.log = [];
    addLog(world, voice.name, voice.transcript, {
      actorId: id,
      entityId: id,
      kind: "dialogue",
      generated: true,
      locationId: world.actors.vale.place,
    });
    const save = encodeSave(world);
    return send(
      "text/javascript",
      `
      import { playerOpenRouter } from './openrouter.mjs';
      const client=playerOpenRouter();
      client.connection=()=>({key:'local-voice-fixture',chat:false});
      client.request=async(path,options)=>{
        if(path!=='audio/speech') return {data:[]};
        const response=await fetch('/fixture-audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options.body),signal:options.signal});
        if(!response.ok) throw Error('Voice fixture request failed');
        return response.blob();
      };
      localStorage.setItem('cosyworld.reflected-shore.v1.voice-fixture-${id}',${JSON.stringify(save)});
      localStorage.setItem('cosyworld.dialogue.sound','on');
      localStorage.setItem('cosyworld.room-music',JSON.stringify({enabled:false}));
      await import('./entry.mjs');
    `,
    );
  }
  if (url.pathname === "/") {
    const page = (
      await readFile(
        new URL("../card-game/index.html", import.meta.url),
        "utf8",
      )
    ).replace('src="./entry.mjs"', `src="/fixture-seed.mjs?voice=${id}"`);
    return send("text/html", page);
  }
  return serve(req, res);
});
server.listen(4189, "127.0.0.1", () =>
  console.log("Voice fixture: http://127.0.0.1:4189/fixture"),
);
