import test from "node:test";
import assert from "node:assert/strict";
import { createNeonDataApiClient, validateNeonDataApiUrl } from "../lib/neon/data-api.ts";

const api = "https://ep-synthetic.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1";

test("Neon endpoint validator accepts only the configured HTTPS Data API", () => {
  assert.equal(validateNeonDataApiUrl(api + "/"), api);
  for (const candidate of [
    "postgresql://user:pass@ep-synthetic.c-6.us-east-2.aws.neon.tech/neondb",
    "https://user:pass@ep-synthetic.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1",
    "http://ep-synthetic.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1",
    "https://ep-synthetic.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth",
    "https://localhost:8888/neondb/rest/v1",
    api + "?debug=1",
    api + "/posts",
    api + "#fragment",
    "not a URL",
  ]) assert.throws(() => validateNeonDataApiUrl(candidate), /PostgREST API/);
});

test("client sends a mock signed-in JWT and builds PostgREST published query", async () => {
  const observed = [];
  const request = async (input, init) => {
    observed.push({
      url: String(input),
      authorization: new Headers(init.headers).get("Authorization"),
      method: init.method,
    });
    return new Response(JSON.stringify([{
      slug: "hello-world", title: "公開筆記", status: "published",
    }]), {status:200,headers:{"content-type":"application/json"}});
  };
  const client = createNeonDataApiClient(api, async()=> "synthetic.jwt.for-tests", request);
  const {data, error} = await client.from("posts")
    .select("slug,title,status").eq("status","published")
    .order("updated_at",{ascending:false}).limit(300);
  assert.equal(error, null);
  assert.equal(data?.[0].slug, "hello-world");
  assert.equal(observed.length, 1);
  assert.match(observed[0].url, /\/posts\?/);
  assert.match(observed[0].url, /status=eq\.published/);
  assert.equal(observed[0].authorization, "Bearer synthetic.jwt.for-tests");
  assert.equal(observed[0].method, "GET");
});

test("client refuses to make a network request without an Auth JWT", async () => {
  let requests = 0;
  const request = async () => {
    requests++;
    return new Response("[]", {status:200,headers:{"content-type":"application/json"}});
  };
  const client = createNeonDataApiClient(api, async()=>"", request);
  const response = await client.from("posts").select("slug");
  assert.equal(requests, 0);
  assert.ok(response.error || !response.data, "Missing JWT must never return data");
});

test("authenticated UPDATE remains scoped by caller-provided predicate", async () => {
  let url, auth, method;
  const client = createNeonDataApiClient(api, async()=> "synthetic-owner-jwt",
    async (input,init) => {
      url = String(input); auth = new Headers(init.headers).get("Authorization");
      method = init.method;
      return new Response(JSON.stringify([{id:"synthetic-post-id"}]),
        {status:200,headers:{"content-type":"application/json"}});
    });
  const result = await client.from("posts")
    .update({title:"修訂版"})
    .eq("id","synthetic-post-id")
    .eq("author_id","synthetic-owner-id")
    .select("id");
  assert.equal(result.error, null);
  assert.equal(auth, "Bearer synthetic-owner-jwt");
  assert.equal(method, "PATCH");
  assert.match(url, /author_id=eq\.synthetic-owner-id/);
  assert.match(url, /id=eq\.synthetic-post-id/);
});
