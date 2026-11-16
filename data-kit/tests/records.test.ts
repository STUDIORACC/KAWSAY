import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { ObservationStore } from "../server/store";
import { serializedDatabase } from "../server/serialized-db";
import { applyMigrations } from "../server/migrations";
import { createHandler } from "../server/http";
import { parseRecords } from "../src/records";

const read=(f:string)=>readFileSync(new URL("../../"+f,import.meta.url),"utf8");
const token="test-records-token-abcdefghijklmnopqrstuvwxyz";
const rec=(over:Record<string,unknown>={})=>({id:"rec-0001-abcdef",crew:"A",type:"Smartwatch",daily:true,hr:72,_u:"2026-11-15T20:00:00.000Z",...over});
const batch=(records:unknown[],states:Record<string,string>={})=>({synthetic:true,records,states});

describe("records validation",()=>{
  it("accepts a normal batch",()=>{expect(parseRecords(batch([rec()],{"rec-0001-abcdef":"reviewed"})).records).toHaveLength(1);});
  it.each([
    ["real data",{synthetic:false,records:[]}],
    ["too many records",batch(Array.from({length:51},(_,i)=>rec({id:"rec-"+String(i).padStart(8,"0")})))],
    ["bad id",batch([rec({id:"x"})])],
    ["bad crew",batch([rec({crew:"A B"})])],
    ["missing _u",batch([rec({_u:undefined})])],
    ["non-ISO _u",batch([rec({_u:"yesterday"})])],
    ["bad state",batch([rec()],{"rec-0001-abcdef":"deleted"})],
    ["oversized record",batch([rec({notes:"x".repeat(17000)})])],
    ["non-object",null],
  ])("rejects %s",(_n,body)=>{expect(()=>parseRecords(body)).toThrow();});
});

describe("records storage + HTTP (PGlite)",()=>{
  let db:PGlite,handler:ReturnType<typeof createHandler>;
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(read("database/001_ingestion.sql"));await db.exec(read("database/demo_seed.sql"));
    await applyMigrations(db,{advisoryLock:false});
    handler=createHandler(new ObservationStore(serializedDatabase(db)),{token,missionId:"MISSION-01"});
  },30000);
  beforeEach(async()=>{await db.exec("TRUNCATE kawsay.crew_records;");});
  afterAll(async()=>{await db?.close();});
  const call=(path:string,init:RequestInit={})=>handler(new Request("http://localhost"+path,{...init,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(init.headers as object)}}));
  const post=(body:unknown)=>call("/api/v1/records",{method:"POST",body:JSON.stringify(body)});

  it("saves records and lists them with their review state",async()=>{
    const res=await post(batch([rec(),rec({id:"rec-0002-abcdef",type:"Emergency",crew:"B"})]));
    expect(await res.json()).toEqual({saved:2,ignored:0,states_updated:0});
    await post(batch([],{"rec-0002-abcdef":"reviewed"}));
    const list=(await (await call("/api/v1/records")).json()).records;
    expect(list).toHaveLength(2);
    expect(list.find((r:any)=>r.record_id==="rec-0002-abcdef")).toMatchObject({crew_id:"B",kind:"Emergency",review_state:"reviewed"});
    expect(list.find((r:any)=>r.record_id==="rec-0001-abcdef").payload.hr).toBe(72);
  });
  it("the newest _u wins and an older copy never overwrites newer data",async()=>{
    await post(batch([rec({hr:80,_u:"2026-11-15T20:05:00.000Z"})]));
    expect(await (await post(batch([rec({hr:60,_u:"2026-11-15T20:01:00.000Z"})]))).json()).toMatchObject({saved:0,ignored:1});
    expect(await (await post(batch([rec({hr:90,_u:"2026-11-15T20:09:00.000Z"})]))).json()).toMatchObject({saved:1});
    const list=(await (await call("/api/v1/records")).json()).records;
    expect(list).toHaveLength(1);expect(list[0].payload.hr).toBe(90);
  });
  it("keeps missing measurements as part of the record",async()=>{
    await post(batch([rec({spo2:null,missing:{spo2:"sensor_failed"}})]));
    const p=(await (await call("/api/v1/records")).json()).records[0].payload;
    expect(p.spo2).toBeNull();expect(p.missing).toEqual({spo2:"sensor_failed"});
  });
  it("rejects invalid data (422), unauthenticated calls (401) and writes nothing on failure",async()=>{
    expect((await post({synthetic:false,records:[]})).status).toBe(422);
    expect((await post(batch([rec(),rec({id:"bad id"})]))).status).toBe(422);
    expect((await handler(new Request("http://localhost/api/v1/records"))).status).toBe(401);
    expect((await call("/api/v1/records",{method:"DELETE"})).status).toBe(405);
    expect((await db.query("SELECT count(*)::int AS n FROM kawsay.crew_records")).rows[0]).toEqual({n:0});
  });
  it("database constraints reject real data and bad states even if the API is bypassed",async()=>{
    await expect(db.query("INSERT INTO kawsay.crew_records(mission_id,record_id,synthetic,crew_id,kind,payload) VALUES('MISSION-01','rec-0009-abcdef',false,'A','x','{}')")).rejects.toThrow();
    await expect(db.query("INSERT INTO kawsay.crew_records(mission_id,record_id,synthetic,crew_id,kind,payload,review_state) VALUES('MISSION-01','rec-0009-abcdef',true,'A','x','{}','zzz')")).rejects.toThrow();
  });
});
