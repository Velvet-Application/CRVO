import * as XLSX from "@e965/xlsx";

type Cell = string | number | boolean | Date | null | undefined;
type StaffRecord = {
  employee_key:string;
  matricule:string|null;
  first_name:string|null;
  last_name:string|null;
  full_name:string;
  name_key:string;
  service:string|null;
  team_code:"A"|"B"|"C"|null;
  source_filename:string;
  source_updated_at:string;
  metadata:Record<string,unknown>;
};

function key(value:unknown){return String(value??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");}
function text(value:unknown){const s=String(value??"").trim();return s||null;}
function nameKey(value:string){return value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr-FR").replace(/[^a-z0-9]+/g," ").trim();}
function pick(row:Record<string,Cell>,aliases:string[]){for(const alias of aliases){const value=row[key(alias)];if(value!==undefined&&value!==null&&String(value).trim()!=="")return value;}return null;}
function team(value:unknown):"A"|"B"|"C"|null{
  const raw=String(value??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();
  if(raw==="A"||raw==="B"||raw==="C")return raw;
  const match=raw.match(/(?:EQUIPE|TEAM|SHIFT|GROUPE)\s*[-_:]?\s*([ABC])\b/);
  return match?.[1] as "A"|"B"|"C"|undefined ?? null;
}

const headerHints=new Set([
  "matricule","matricule_salarie","employee_id","code_salarie","code_collaborateur",
  "nom","prenom","nom_prenom","nom_complet","collaborateur","salarie","mecanicien","operateur",
  "service","secteur","atelier","departement","department","metier","activite",
  "equipe","equipe_travail","team","shift","groupe",
]);

function gridToRows(grid:Cell[][]){
  const candidates=grid.slice(0,30).map((row,index)=>{const keys=row.map(key).filter(Boolean);return{index,filled:keys.length,score:keys.filter(item=>headerHints.has(item)).length*25+Math.min(keys.length,12)}}).filter(item=>item.filled>=2).sort((a,b)=>b.score-a.score);
  const headerIndex=candidates[0]?.index??0;
  const seen=new Map<string,number>();
  const headers=(grid[headerIndex]??[]).map((value,index)=>key(value)||`col_${index+1}`).map(name=>{const count=(seen.get(name)??0)+1;seen.set(name,count);return count===1?name:`${name}_${count}`});
  return grid.slice(headerIndex+1).filter(row=>row.some(value=>String(value??"").trim())).map(row=>{const out:Record<string,Cell>={};headers.forEach((name,index)=>out[name]=row[index]??null);return out;});
}

function parseCsv(source:string){
  const first=source.split(/\r?\n/,1)[0]??"";
  const delimiter=[";","\t",","].map(item=>({item,count:first.split(item).length})).sort((a,b)=>b.count-a.count)[0]?.item??";";
  const grid:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(ch===delimiter&&!quoted){row.push(cell);cell="";}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&source[i+1]==='\n')i++;row.push(cell);cell="";if(row.some(value=>value.trim()))grid.push(row);row=[];}
    else cell+=ch;
  }
  row.push(cell);if(row.some(value=>value.trim()))grid.push(row);
  return gridToRows(grid);
}

function parseWorkbook(buffer:ArrayBuffer){
  const workbook=XLSX.read(buffer,{type:"array",cellDates:true});
  let best:Record<string,Cell>[]=[];
  for(const sheetName of workbook.SheetNames){
    const sheet=workbook.Sheets[sheetName];if(!sheet)continue;
    const grid=XLSX.utils.sheet_to_json<Cell[]>(sheet,{header:1,raw:true,defval:null}) as Cell[][];
    const rows=gridToRows(grid);if(rows.length>best.length)best=rows;
  }
  return best;
}

export async function parseStaffDirectory(file:File):Promise<StaffRecord[]>{
  const buffer=await file.arrayBuffer();
  const rows=/\.csv$/i.test(file.name)?parseCsv(new TextDecoder("utf-8").decode(buffer)):parseWorkbook(buffer);
  const now=new Date().toISOString();
  const byKey=new Map<string,StaffRecord>();
  for(const raw of rows){
    const matricule=text(pick(raw,["matricule","matricule_salarie","employee_id","id_salarie","code_salarie","code_collaborateur","mat"]));
    const first=text(pick(raw,["prenom","first_name","firstname"]));
    const last=text(pick(raw,["nom","last_name","lastname"]));
    const explicit=text(pick(raw,["nom_prenom","nom_complet","full_name","collaborateur","salarie","mecanicien","mechanic_name","operateur","employee"]));
    const full=(explicit??[first,last].filter(Boolean).join(" ")).trim();
    if(!full)continue;
    const service=text(pick(raw,["service","secteur","atelier","department","departement","metier","activite","activity"]));
    const teamCode=team(pick(raw,["equipe","equipe_travail","team","shift","groupe"]));
    if(!matricule&&!service&&!teamCode)continue;
    const normalized=nameKey(full);if(!normalized)continue;
    const employeeKey=matricule?`mat:${key(matricule)}`:`name:${normalized.replace(/\s+/g,"_")}`;
    byKey.set(employeeKey,{
      employee_key:employeeKey,
      matricule,
      first_name:first,
      last_name:last,
      full_name:full,
      name_key:full.toLocaleLowerCase("fr-FR").trim(),
      service,
      team_code:teamCode,
      source_filename:file.name,
      source_updated_at:now,
      metadata:{detected_from:"direct_import"},
    });
  }
  return [...byKey.values()];
}
