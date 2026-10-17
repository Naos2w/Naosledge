import test from "node:test";
import assert from "node:assert/strict";
import {backend} from "../lib/backend.ts";

function preserveEnv(fn) {
  const oldServer=process.env.NAOSLEDGE_BACKEND;
  const oldClient=process.env.NEXT_PUBLIC_NAOSLEDGE_BACKEND;
  try {fn();} finally {
    if(oldServer===undefined) delete process.env.NAOSLEDGE_BACKEND;
    else process.env.NAOSLEDGE_BACKEND=oldServer;
    if(oldClient===undefined) delete process.env.NEXT_PUBLIC_NAOSLEDGE_BACKEND;
    else process.env.NEXT_PUBLIC_NAOSLEDGE_BACKEND=oldClient;
  }
}

test("backend defaults to existing Supabase behavior", () => preserveEnv(()=>{
  delete process.env.NAOSLEDGE_BACKEND;
  delete process.env.NEXT_PUBLIC_NAOSLEDGE_BACKEND;
  assert.equal(backend(),"supabase");
}));

test("Neon must be explicitly selected in BOTH browser and server",()=>preserveEnv(()=>{
  process.env.NAOSLEDGE_BACKEND="neon";
  process.env.NEXT_PUBLIC_NAOSLEDGE_BACKEND="neon";
  assert.equal(backend(),"neon");
  process.env.NEXT_PUBLIC_NAOSLEDGE_BACKEND="supabase";
  assert.throws(()=>backend(),/不一致/);
  process.env.NAOSLEDGE_BACKEND="supabase";
  assert.equal(backend(),"supabase");
  process.env.NEXT_PUBLIC_NAOSLEDGE_BACKEND="neon";
  assert.throws(()=>backend(),/不一致/);
  process.env.NAOSLEDGE_BACKEND="production";
  assert.throws(()=>backend(),/必須是/);
}));
