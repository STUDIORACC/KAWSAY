/** Validation of the batch of interface records sent to /api/v1/records. Synthetic data only. */
export interface RecordsBatch { records: Array<{ id: string; crew: string; type: string; _u: string; [k: string]: unknown }>; states: Record<string, "pending" | "reviewed" | "closed"> }
const ID=/^[A-Za-z0-9._-]{8,64}$/, CREW=/^[A-Za-z0-9_-]{1,16}$/;
const STATES=new Set(["pending","reviewed","closed"]);
const isObject=(v: unknown): v is Record<string, unknown>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
export function parseRecords(input: unknown): RecordsBatch {
  if(!isObject(input))throw new Error("El cuerpo debe ser un objeto JSON");
  if(input.synthetic!==true)throw new Error("Solo se aceptan datos sintéticos (synthetic: true)");
  const list=input.records??[], states=input.states??{};
  if(!Array.isArray(list)||list.length>50)throw new Error("records debe ser una lista de hasta 50 elementos");
  if(!isObject(states)||Object.keys(states).length>200)throw new Error("states debe ser un objeto de hasta 200 elementos");
  const records: RecordsBatch["records"]=[];
  for(const r of list){
    if(!isObject(r))throw new Error("Cada registro debe ser un objeto");
    if(typeof r.id!=="string"||!ID.test(r.id))throw new Error("Registro con id inválido");
    if(typeof r.crew!=="string"||!CREW.test(r.crew))throw new Error("Registro con tripulante inválido");
    if(typeof r.type!=="string"||!r.type||r.type.length>32)throw new Error("Registro con tipo inválido");
    if(typeof r._u!=="string"||Number.isNaN(Date.parse(r._u))||new Date(r._u).toISOString()!==r._u)throw new Error("Registro sin marca de actualización _u válida");
    if(Buffer.byteLength(JSON.stringify(r))>16000)throw new Error("Registro demasiado grande");
    records.push(r as RecordsBatch["records"][number]);
  }
  const out: RecordsBatch["states"]={};
  for(const [id,state] of Object.entries(states)){
    if(!ID.test(id)||typeof state!=="string"||!STATES.has(state))throw new Error("Estado de revisión inválido");
    out[id]=state as "pending"|"reviewed"|"closed";
  }
  return {records,states:out};
}
