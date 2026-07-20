;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="226a739e-4eca-cc50-0cf8-b6dba1a587a1")}catch(e){}}();
(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,246230,21150,e=>{"use strict";let t={query:(e,t)=>["projects",e,"query",...t],ongoingQueries:e=>["projects",e,"ongoing-queries"]};e.s(["sqlKeys",0,t],21150),e.s(["databaseKeys",0,{schemas:e=>["projects",e,"schemas"],keywords:e=>["projects",e,"keywords"],migrations:e=>["projects",e,"migrations"],tableColumns:(e,t,a)=>["projects",e,"table-columns",t,a],databaseFunctions:(e,t)=>["projects",e,"database-functions",t].filter(Boolean),entityDefinition:(e,t)=>["projects",e,"entity-definition",t],entityDefinitions:(e,t)=>["projects",e,"entity-definitions",t],tableDefinition:(e,t)=>["projects",e,"table-definition",t],viewDefinition:(e,t,a)=>["projects",e,"view-definition",t,a??!1],backups:e=>["projects",e,"database","backups"],poolingConfiguration:e=>["projects",e,"database","pooling-configuration"],indexesFromQuery:(e,t)=>["projects",e,"indexes",{query:t}],indexAdvisorFromQuery:(e,t,a)=>{let r;if(a)try{r=new URL(a).host}catch{r=void 0}return["projects",e,"index-advisor",{query:t,connectionFingerprint:r}]},tableConstraints:(e,t)=>["projects",e,"table-constraints",t],foreignKeyConstraints:(e,t,a={})=>["projects",e,"foreign-key-constraints",t,a],databaseSize:e=>["projects",e,"database-size"],maxConnections:e=>["projects",e,"max-connections"],pgbouncerStatus:e=>["projects",e,"pgbouncer","status"],pgbouncerConfig:e=>["projects",e,"pgbouncer","config"],checkPrimaryKeysExists:(e,t)=>["projects",e,"check-primary-keys",t],tableIndexAdvisor:(e,t,a)=>["projects",e,"table-index-advisor",t,a],supamonitorEnabled:e=>["projects",e,"supamonitor-enabled"]},"getLiveTupleEstimateKey",0,(e,a,r="public")=>t.query(e,["live-tuple-estimate",r,a])],246230)},801834,e=>{"use strict";var t=e.i(850036),a=e.i(125356),r=e.i(246230),s=e.i(617361),i=e.i(681328);let n=t.default.schemas.list();async function o({projectRef:e,connectionString:t},a){let{result:r}=await (0,s.executeSql)({projectRef:e,connectionString:t,sql:n.sql,queryKey:["schemas"]},a);return Array.isArray(r)?r:i.EMPTY_ARR}e.s(["getSchemas",0,o,"invalidateSchemasQuery",0,function(e,t){return e.invalidateQueries({queryKey:r.databaseKeys.schemas(t)})},"prefetchSchemas",0,function(e,{projectRef:t,connectionString:a}){return e.fetchQuery({queryKey:r.databaseKeys.schemas(t),queryFn:({signal:e})=>o({projectRef:t,connectionString:a},e)})},"useSchemasQuery",0,({projectRef:e,connectionString:t},{enabled:s=!0,...i}={})=>(0,a.useQuery)({queryKey:r.databaseKeys.schemas(e),queryFn:({signal:a})=>o({projectRef:e,connectionString:t},a),enabled:s&&void 0!==e,...i})])},12214,e=>{"use strict";var t=e.i(531837),a=e.i(615515);let r=t.object({index:t.number(),columns:t.array(t.object({name:t.string(),type:t.string()})),is_new_schema:t.boolean(),schema:t.string(),schema_name:t.string(),table_name:t.string(),object:t.any().optional()}).passthrough(),s=e=>Object.fromEntries(e.map(e=>e.split("=")));function i(e,t){if("wasm_fdw_handler"===e.handlerName){let a=s(t?.server_options??[]);return e.server.options.find(e=>"fdw_package_name"===e.name)?.defaultValue===a.fdw_package_name}return e.handlerName===t?.handler}e.s(["NewTable",0,{},"convertKVStringArrayToJson",0,s,"formatWrapperTables",0,(e,t)=>(e?.tables??[]).map(r=>{let s=0,i=Object.fromEntries(r.options.map(e=>e.split("=")));switch(e.handler){case a.WRAPPER_HANDLERS.STRIPE:s=t?.tables.findIndex(e=>e.options.find(e=>"object"===e.name)?.defaultValue===i.object)??0;break;case a.WRAPPER_HANDLERS.FIREBASE:s="auth/users"===i.object?t?.tables.findIndex(e=>e.options.find(e=>"auth/users"===e.defaultValue))??0:t?.tables.findIndex(e=>"Firestore Collection"===e.label)??0;case a.WRAPPER_HANDLERS.S3:case a.WRAPPER_HANDLERS.AIRTABLE:case a.WRAPPER_HANDLERS.LOGFLARE:case a.WRAPPER_HANDLERS.BIG_QUERY:case a.WRAPPER_HANDLERS.CLICK_HOUSE:}return{...i,index:s,id:r.id,columns:r.columns??[],is_new_schema:!1,schema:r.schema,schema_name:r.schema,table_name:r.name}}),"getEditionFormSchema",0,e=>{let a={wrapper_name:t.string().min(1,"Please provide a name for your wrapper"),tables:t.array(r,{required_error:"Please provide at least one table"}).min(1,"Please provide at least one table")};return e.server.options.forEach(e=>{if(e.required){a[e.name]=t.string().min(1,"Required");return}a[e.name]=t.string().optional()}),t.object(a)},"getRequiredExtensionsToInstall",0,function(e,t){return void 0===e?null:e.filter(e=>t.includes(e.name)&&!e.installed_version)},"getTableFormSchema",0,e=>{let a={table_name:t.string().min(1,"Required"),schema:t.string().min(1,"Required"),schema_name:t.string().optional(),columns:t.array(t.object({name:t.string().min(1,"Required"),type:t.string().min(1,"Required")}))};return e.options.forEach(e=>{if(e.required){a[e.name]=t.string().min(1,"Required");return}a[e.name]=t.string().optional()}),t.object(a).passthrough().superRefine((e,t)=>{"custom"!==e.schema||e.schema_name||t.addIssue({code:"custom",path:["schema_name"],message:"Required"})})},"getWrapperCreationFormSchema",0,e=>{let a={wrapper_name:t.string().min(1,"Please provide a name for your wrapper")};return e.server.options.forEach(e=>{if(e.required){a[e.name]=t.string().min(1,"Required");return}a[e.name]=t.string().optional()}),t.discriminatedUnion("mode",[t.object({mode:t.literal("tables"),tables:t.array(r,{required_error:"Please provide at least one table"}).min(1,"Please provide at least one table")}).merge(t.object(a)),t.object({mode:t.literal("schema"),source_schema:t.string().min(1,"Please provide a source schema"),target_schema:t.string().min(1,"Please provide an unique target schema")}).merge(t.object(a))])},"getWrapperMetaForWrapper",0,function(e){return a.WRAPPERS.find(t=>i(t,e))},"hasForeignSchemaSupport",0,function(e){return!!e?.installed_version&&e.installed_version>="0.5.0"},"wrapperMetaComparator",0,i])},298625,33942,584258,e=>{"use strict";e.i(850036);var t=e.i(479084);let a=()=>t.safeSql`
    select
      s.oid as "id",
      w.fdwname as "name",
      s.srvname as "server_name",
      s.srvoptions as "server_options",
      c.proname as "handler",
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', c.oid::bigint,
            'schema', relnamespace::regnamespace::text,
            'name', c.relname,
            'columns', (
              select jsonb_agg(
                jsonb_build_object(
                  'name', a.attname,
                  'type', pg_catalog.format_type(a.atttypid, a.atttypmod)
                )
              )
              from pg_catalog.pg_attribute a
              where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
            ),
            'options', t.ftoptions
          )
        )
        from pg_catalog.pg_class c
        join pg_catalog.pg_foreign_table t on c.oid = t.ftrelid
        where c.oid = any (select t.ftrelid from pg_catalog.pg_foreign_table t where t.ftserver = s.oid)
      ) as "tables"
    from pg_catalog.pg_foreign_server s
    join pg_catalog.pg_foreign_data_wrapper w on s.srvfdw = w.oid
    join pg_catalog.pg_proc c on w.fdwhandler = c.oid;
  `;function r({wrapperMeta:e,formState:a,mode:s,tables:i,sourceSchema:n,targetSchema:o,schemaOptions:l=[]}){let d=(0,t.joinSqlFragments)(i.filter(e=>e.is_new_schema).map(e=>t.safeSql`create schema if not exists ${(0,t.ident)(e.schema_name)};`),"\n"),c=t.safeSql`
    create foreign data wrapper ${(0,t.ident)(a.wrapper_name)}
    handler ${(0,t.ident)(e.handlerName)}
    validator ${(0,t.ident)(e.validatorName)};
  `,m=e.server.options.filter(e=>e.encrypted),p=e.server.options.filter(e=>!e.encrypted),f=m.map(e=>{let r=`${a.wrapper_name}_${e.name}`,s=(0,t.literal)(a[e.name]||"");return t.safeSql`
      do $$
      begin
        -- Old wrappers has an implicit dependency on pgsodium. For new wrappers
        -- we use Vault directly.
        if (select extversion from pg_extension where extname = 'wrappers') in (
          '0.1.0',
          '0.1.1',
          '0.1.4',
          '0.1.5',
          '0.1.6',
          '0.1.7',
          '0.1.8',
          '0.1.9',
          '0.1.10',
          '0.1.11',
          '0.1.12',
          '0.1.14',
          '0.1.15',
          '0.1.16',
          '0.1.17',
          '0.1.18',
          '0.1.19',
          '0.2.0',
          '0.3.0',
          '0.3.1',
          '0.4.0',
          '0.4.1',
          '0.4.2',
          '0.4.3',
          '0.4.4',
          '0.4.5'
        ) then
          create extension if not exists pgsodium;

          perform pgsodium.create_key(
            name := ${(0,t.literal)(r)}
          );

          perform vault.create_secret(
            new_secret := ${s},
            new_name   := ${(0,t.literal)(r)},
            new_key_id := (select id from pgsodium.valid_key where name = ${(0,t.literal)(r)})
          );
        else
          perform vault.create_secret(
            new_secret := ${s},
            new_name := ${(0,t.literal)(r)}
          );
        end if;
      end $$;
    `}),u=(0,t.joinSqlFragments)(f,"\n"),g=m.filter(e=>a[e.name]).map(e=>t.safeSql`${(0,t.ident)(e.name)} ''%s''`),h=p.filter(e=>a[e.name]),b=h.map(e=>t.safeSql`${(0,t.ident)(e.name)} %L`),y=(0,t.joinSqlFragments)([...g,...b],","),w=t.safeSql`
    do $$
    declare
      -- Old wrappers has an implicit dependency on pgsodium. For new wrappers
      -- we use Vault directly.
      is_using_old_wrappers bool;
      ${(0,t.joinSqlFragments)(m.map(e=>t.safeSql`${(0,t.ident)(`v_${e.name}`)} text;`),"\n")}
    begin
      is_using_old_wrappers := (select extversion from pg_extension where extname = 'wrappers') in (
        '0.1.0',
        '0.1.1',
        '0.1.4',
        '0.1.5',
        '0.1.6',
        '0.1.7',
        '0.1.8',
        '0.1.9',
        '0.1.10',
        '0.1.11',
        '0.1.12',
        '0.1.14',
        '0.1.15',
        '0.1.16',
        '0.1.17',
        '0.1.18',
        '0.1.19',
        '0.2.0',
        '0.3.0',
        '0.3.1',
        '0.4.0',
        '0.4.1',
        '0.4.2',
        '0.4.3',
        '0.4.4',
        '0.4.5'
      );
      ${(0,t.joinSqlFragments)(m.map(e=>t.safeSql`
              if is_using_old_wrappers then
                select id into ${(0,t.ident)(`v_${e.name}`)} from pgsodium.valid_key where name = ${(0,t.literal)(`${a.wrapper_name}_${e.name}`)} limit 1;
              else
                select id into ${(0,t.ident)(`v_${e.name}`)} from vault.secrets where name = ${(0,t.literal)(`${a.wrapper_name}_${e.name}`)} limit 1;
              end if;
            `),"\n")}
    
      execute format(
        E'create server ${(0,t.ident)(a.server_name)} foreign data wrapper ${(0,t.ident)(a.wrapper_name)} options (${y});',
        ${(0,t.joinSqlFragments)([...m.filter(e=>a[e.name]).map(e=>(0,t.ident)(`v_${e.name}`)),...h.map(e=>(0,t.literal)(a[e.name]))],",")}
      );
    end $$;
  `,_=(0,t.joinSqlFragments)(i.map(e=>{let r=e.columns;return t.safeSql`
        create foreign table ${(0,t.ident)(e.schema_name)}.${(0,t.ident)(e.table_name)} (
          ${(0,t.joinSqlFragments)(r.map(e=>t.safeSql`${(0,t.ident)(e.name)} ${(0,t.keyword)(e.type)}`),",")}
        )
        server ${(0,t.ident)(a.server_name)}
        options (
          ${(0,t.joinSqlFragments)(Object.entries(e).filter(([e,t])=>"table_name"!==e&&"schema_name"!==e&&"columns"!==e&&"index"!==e&&"is_new_schema"!==e&&!!t).map(([e,a])=>t.safeSql`${(0,t.ident)(e)} ${(0,t.literal)(a)}`),",")}
        );
      `}),"\n\n"),x=(0,t.joinSqlFragments)([...l,t.safeSql`strict 'true'`],", ");return t.safeSql`
    ${d}

    ${c}

    ${u}

    ${w}

    ${"tables"===s?_:t.safeSql``}

    ${"schema"===s?t.safeSql`
  import foreign schema ${(0,t.ident)(n)} from server ${(0,t.ident)(a.server_name)} into ${(0,t.ident)(o)} options (${x});
`:t.safeSql``}
  `}let s=({wrapper:e,wrapperMeta:a})=>{let r=a.server.options.filter(e=>e.encrypted).map(a=>{let r=`${e.name}_${a.name}`;return t.safeSql`
      do $$
      begin
        -- Old wrappers has an implicit dependency on pgsodium. For new wrappers
        -- we use Vault directly.
        if (select extversion from pg_extension where extname = 'wrappers') in (
          '0.1.0',
          '0.1.1',
          '0.1.4',
          '0.1.5',
          '0.1.6',
          '0.1.7',
          '0.1.8',
          '0.1.9',
          '0.1.10',
          '0.1.11',
          '0.1.12',
          '0.1.14',
          '0.1.15',
          '0.1.16',
          '0.1.17',
          '0.1.18',
          '0.1.19',
          '0.2.0',
          '0.3.0',
          '0.3.1',
          '0.4.0',
          '0.4.1',
          '0.4.2',
          '0.4.3',
          '0.4.4',
          '0.4.5'
        ) then
          delete from vault.secrets where key_id = (select id from pgsodium.valid_key where name = ${(0,t.literal)(r)});

          delete from pgsodium.key where name = ${(0,t.literal)(r)};
        else
          delete from vault.secrets where name = ${(0,t.literal)(r)};
        end if;
      end $$;
    `}),s=(0,t.joinSqlFragments)(r,"\n");return t.safeSql`
    drop foreign data wrapper if exists ${(0,t.ident)(e.name)} cascade;

    ${s}
  `};e.s(["getCreateFDWSql",0,r,"getDeleteFDWSql",0,s,"getDropForeignTableSql",0,function({schema:e,table:a}){return t.safeSql`
drop foreign table if exists ${(0,t.ident)(e)}.${(0,t.ident)(a)};
`},"getFDWsSql",0,a,"getImportForeignSchemaSql",0,function({serverName:e,sourceSchema:a,targetSchema:r,schemaOptions:s=[]}){let i=(0,t.joinSqlFragments)([...s,t.safeSql`strict 'true'`],", ");return t.safeSql`
  import foreign schema ${(0,t.ident)(a)} from server ${(0,t.ident)(e)} into ${(0,t.ident)(r)} options (${i});
`},"getUpdateFDWSql",0,({wrapper:e,wrapperMeta:a,formState:i,tables:n})=>{let o=s({wrapper:e,wrapperMeta:a}),l=r({wrapperMeta:a,formState:i,tables:n,mode:"tables",sourceSchema:"",targetSchema:""});return t.safeSql`
    ${o}

    ${l}
  `}],33942);var i=e.i(125356);let n={list:e=>["projects",e,"fdws"]};e.s(["fdwKeys",0,n],584258);var o=e.i(617361),l=e.i(681328);async function d({projectRef:e,connectionString:t},r){let s=a(),{result:i}=await (0,o.executeSql)({projectRef:e,connectionString:t,sql:s,queryKey:["fdws"]},r);return Array.isArray(i)?i:l.EMPTY_ARR}e.s(["getFDWs",0,d,"useFDWsQuery",0,({projectRef:e,connectionString:t},{enabled:a=!0,...r}={})=>(0,i.useQuery)({queryKey:n.list(e),queryFn:({signal:a})=>d({projectRef:e,connectionString:t},a),enabled:a&&void 0!==e,...r})],298625)},591052,e=>{"use strict";function t(e){let t=parseFloat(e);return Number.isFinite(t)?t:void 0}function a(e){let t=parseInt(e,10);return Number.isNaN(t)?void 0:t}function r(e){if(e.details){let t=e.details.match(/Rows Removed by Filter:\s*(\d+)/);t&&(e.rowsRemovedByFilter=a(t[1]))}e.children.forEach(r)}e.s(["calculateMaxDuration",0,function(e){return e.reduce((e,t)=>Math.max(e,function e(t){return Math.max(t.actualTime?t.actualTime.end-t.actualTime.start:0,t.children.reduce((t,a)=>Math.max(t,e(a)),0))}(t)),0)},"calculateSummary",0,function(e){let t={totalTime:0,totalCost:0,maxCost:0,hasSeqScan:!1,seqScanTables:[],hasIndexScan:!1},a=e=>{e.actualTime&&(t.totalTime=Math.max(t.totalTime,e.actualTime.end)),e.cost&&(t.maxCost=Math.max(t.maxCost,e.cost.end));let r=e.operation.toLowerCase();if(r.includes("seq scan")){t.hasSeqScan=!0;let a=e.details.match(/on\s+((?:"[^"]+"|[\w]+)(?:\.(?:"[^"]+"|[\w]+))*)/);a&&t.seqScanTables.push(a[1])}r.includes("index")&&(t.hasIndexScan=!0),e.children.forEach(a)};return e.forEach(a),t.totalCost=e[0]?.cost?.end??0,t},"createNodeTree",0,function(e){let s=function(e){let r=e.map(e=>e["QUERY PLAN"]||"").filter(Boolean),s=[],i=[],n=/^(Filter|Sort Key|Group Key|Hash Cond|Join Filter|Index Cond|Recheck Cond|Rows Removed by Filter|Rows Removed by Index Recheck|Output|Merge Cond|Sort Method|Worker \d+|Buffers|Planning Time|Execution Time|One-Time Filter|InitPlan|SubPlan):/;for(let e=0;e<r.length;e++){let o=r[e];if(!o.trim())continue;let l=o.match(/^(\s*)/),d=l?l[1].length:0,c=o.includes("->"),m=o,p=d;if(c){let e=o.indexOf("->");p=e,m=o.substring(e+2).trim()}else m=o.trim();if(m.startsWith("Planning Time:")||m.startsWith("Execution Time:")||m.startsWith("Planning:")||m.startsWith("Execution:"))continue;if(n.test(m)&&i.length>0){let e=i[i.length-1].node;e.details+=(e.details?"\n":"")+m;continue}if(!c&&i.length>0&&d>0){let e=i[i.length-1];if(d>e.indent&&!m.match(/^\w+.*\(cost=/)){e.node.details+=(e.node.details?"\n":"")+m;continue}}let f=m.match(/^(.+?)\s*(\([^)]*cost=[^)]+\)(?:\s*\([^)]+\))*)?\s*$/);if(!f)continue;let[,u,g]=f,h=g?g.replace(/^\(|\)$/g,"").replace(/\)\s*\(/g," "):void 0,b=u.trim(),y="",w=u.match(/^(.+?)\s+on\s+(.+)$/i),_=u.match(/^(.+?)\s+using\s+(.+)$/i);w?(b=w[1].trim(),y="on "+w[2].trim()):_&&(b=_[1].trim(),y="using "+_[2].trim()),function(e,t,a,r){for(;r.length>0&&r[r.length-1].indent>=t;)r.pop();0===r.length?a.push(e):r[r.length-1].node.children.push(e),r.push({node:e,indent:t})}(function(e,r,s,i,n){let o={operation:e.trim(),details:r?.trim()||"",level:i,children:[],raw:n};if(s){let e=s.match(/cost=([\d.]+)\.\.([\d.]+)/);if(e){let a=t(e[1]),r=t(e[2]);void 0!==a&&void 0!==r&&(o.cost={start:a,end:r})}let r=s.match(/rows=(\d+)/);r&&(o.rows=a(r[1]));let i=s.match(/width=(\d+)/);i&&(o.width=a(i[1]));let n=s.match(/actual time=([\d.]+)\.\.([\d.]+)/);if(n){let e=t(n[1]),r=t(n[2]);void 0!==e&&void 0!==r&&(o.actualTime={start:e,end:r});let i=s.substring(s.indexOf("actual time=")).match(/rows=(\d+)/);i&&(o.actualRows=a(i[1]))}}return o}(b,y,h,c?Math.floor(p/6)+1:0,o),p,s,i)}return s}(e);return s.forEach(r),s},"parseDetailLines",0,function(e){if(!e)return[];let t=e.split("\n").filter(Boolean),a=[];for(let e of t){let t=e.indexOf(":");t>0?a.push({label:e.substring(0,t+1),value:e.substring(t+1).trim()}):e.trim()&&a.push({label:"",value:e.trim()})}return a}])},534259,690247,e=>{"use strict";let t={TableCreated:"table_created",TableDataAdded:"table_data_added",TableRLSEnabled:"table_rls_enabled"};Object.values(t),e.s(["TABLE_EVENT_ACTIONS",0,t],690247);class a{static DETECTORS=[{type:t.TableCreated,patterns:[/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<schema>(?:"[^"]+"|[\w]+)\.)?(?<table>(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[\w]+))/i,/CREATE\s+TEMP(?:ORARY)?\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<schema>(?:"[^"]+"|[\w]+)\.)?(?<table>(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[\w]+))/i,/CREATE\s+UNLOGGED\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<schema>(?:"[^"]+"|[\w]+)\.)?(?<table>(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[\w]+))/i,/SELECT\s+.*?\s+INTO\s+(?<schema>(?:"[^"]+"|[\w]+)\.)?(?<table>(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[\w]+))/is,/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<schema>(?:"[^"]+"|[\w]+)\.)?(?<table>(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[\w]+))\s+AS\s+SELECT/i]},{type:t.TableDataAdded,patterns:[/INSERT\s+INTO\s+(?<schema>(?:"[^"]+"|[\w]+)\.)?(?<table>(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[\w]+))/i,/COPY\s+(?<schema>(?:"[^"]+"|[\w]+)\.)?(?<table>(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[\w]+))\s+FROM/i]},{type:t.TableRLSEnabled,patterns:[/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?<schema>(?:"[^"]+"|[\w]+)\.)?(?<table>(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[\w]+)).*?ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?<schema>(?:"[^"]+"|[\w]+)\.)?(?<table>(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[\w]+)).*?ENABLE\s+RLS/i]}];cleanIdentifier(e){return e?.replace(/["`']/g,"").replace(/\.$/,"")}stripDollarQuoteBodies(e){return e.replace(/(\$[a-zA-Z0-9_]*\$)[\s\S]*?\1/g,"$1$1")}match(e){for(let{type:t,patterns:r}of a.DETECTORS)for(let a of r){let r=e.match(a);if(r?.groups)return{type:t,schema:this.cleanIdentifier(r.groups.schema),tableName:this.cleanIdentifier(r.groups.table??r.groups.object)}}return null}splitStatements(e){let t=e.match(/'([^']|'')*'|"([^"]|"")*"|\$[a-zA-Z0-9_]*\$[\s\S]*?\$[a-zA-Z0-9_]*\$|;|[^'"$;]+/g)||[],a=[],r="";for(let e of t)";"===e?(r.trim()&&a.push(r.trim()),r=""):r+=e;return r.trim()&&a.push(r.trim()),a}deduplicate(e){let t=new Set;return e.filter(e=>{let a=`${e.type}:${e.schema||""}:${e.tableName||""}`;return!t.has(a)&&(t.add(a),!0)})}removeComments(e){return e.replace(/--.*?$/gm,"").replace(/\/\*[\s\S]*?\*\//g,"")}getTableEvents(e){let t=this.splitStatements(this.removeComments(this.stripDollarQuoteBodies(e))),a=[];for(let e of t){let t=this.match(e);t&&a.push(t)}return this.deduplicate(a)}}let r=new a;e.s(["sqlEventParser",0,r],534259)},617361,e=>{"use strict";e.i(850036);var t=e.i(389273),a=e.i(248593),r=e.i(705541),s=e.i(964574),i=e.i(739114),n=e.i(591052),o=e.i(234745),l=e.i(10429),d=e.i(534259),c=e.i(967052);let m=["branches","settings-v2","addons","custom-domains","content"],p="Query cost exceeds threshold";async function f({projectRef:e,connectionString:r,sql:s,queryKey:i,handleError:d,isRoleImpersonationEnabled:c=!1,isStatementTimeoutDisabled:m=!1,preflightCheck:u=!1},g,h,b){let y,w;if(!e)throw Error("projectRef is required");if(new Blob([s]).size>.98*l.MB)throw Error("Query is too large to be run via the SQL Editor");let _=new Headers(h);if(r&&_.set("x-connection-encrypted",r),b){let e=await b({query:s,headers:_});"data"in e?y=e.data:w=e.error}else{let t={signal:g,headers:_,params:{path:{ref:e},header:{"x-connection-encrypted":r??"","x-pg-application-name":m?"supabase/dashboard-query-editor":a.DEFAULT_PLATFORM_APPLICATION_NAME}}};if(u){let{data:e}=await (0,o.post)("/platform/pg-meta/{ref}/query",{...t,body:{query:`explain ${s}`,disable_statement_timeout:m},params:{...t.params,query:{key:"preflight-check"}}}),a=e?(0,n.createNodeTree)(e):void 0,r=a?(0,n.calculateSummary)(a):void 0,i=r?.totalCost??0;if(i>=2e5)return(0,o.handleError)({message:p,code:i,metadata:{cost:i,sql:s}})}let l=i?.filter(e=>"string"==typeof e||"number"==typeof e).join("-")??"",d=await (0,o.post)("/platform/pg-meta/{ref}/query",{...t,body:{query:s,disable_statement_timeout:m},params:{...t.params,query:{key:l}}});y=d.data,w=d.error}if(w){if(c&&"object"==typeof w&&null!==w&&"error"in w&&"formattedError"in w){let e=w,a=/LINE (\d+):/im,[,r]=a.exec(e.error)??[],s=Number(r);isNaN(s)||(e={...e,error:e.error.replace(a,`LINE ${s-t.ROLE_IMPERSONATION_SQL_LINE_COUNT}:`),formattedError:e.formattedError.replace(a,`LINE ${s-t.ROLE_IMPERSONATION_SQL_LINE_COUNT}:`)}),w=e}if(void 0!==d)return d(w);(0,o.handleError)(w)}return c&&Array.isArray(y)&&y?.[0]?.[t.ROLE_IMPERSONATION_NO_RESULTS]===1?{result:[]}:{result:y}}e.s(["COST_THRESHOLD_ERROR",0,p,"executeSql",0,f,"useExecuteSqlMutation",0,({onSuccess:e,onError:t,...a}={})=>{let n=(0,s.useQueryClient)(),o=(0,c.useTrack)();return(0,r.useMutation)({mutationFn:e=>f(e),async onSuccess(t,a,r){let{contextualInvalidation:s,sql:i,projectRef:l}=a;try{d.sqlEventParser.getTableEvents(i).forEach(e=>{l&&o(e.type,{method:"sql_editor",schema_name:e.schema,table_name:e.tableName},{project:l})})}catch(e){console.error("Failed to parse SQL for telemetry:",e)}let c=i.toLowerCase(),p=c.includes("create ")||c.includes("alter ")||c.includes("drop ");if(s&&l&&p){let e=n.getQueryCache().findAll({queryKey:["projects",l]}).map(e=>e.queryKey).filter(e=>!m.some(t=>e.includes(t)));await Promise.all(e.map(e=>n.invalidateQueries({queryKey:e})))}await e?.(t,a,r)},async onError(e,a,r){void 0===t?i.toast.error(`Failed to execute SQL: ${e.message}`):t(e,a,r)},...a})}])},627069,e=>{"use strict";var t=e.i(221628),a=e.i(416340),r=e.i(843778);let s=a.forwardRef(({className:e,...a},s)=>(0,t.jsx)("div",{ref:s,className:(0,r.cn)("overflow-hidden rounded-lg border bg-surface-100 text-card-foreground shadow-xs",e),...a}));s.displayName="Card";let i=a.forwardRef(({className:e,...a},s)=>(0,t.jsx)("div",{ref:s,className:(0,r.cn)("flex flex-col space-y-1.5 py-4 px-(--card-padding-x) border-b",e),...a}));i.displayName="CardHeader";let n=a.forwardRef(({className:e,...a},s)=>(0,t.jsx)("h3",{ref:s,className:(0,r.cn)("text-xs font-mono uppercase",e),...a}));n.displayName="CardTitle";let o=a.forwardRef(({className:e,...a},s)=>(0,t.jsx)("p",{ref:s,className:(0,r.cn)("text-sm text-foreground-lighter",e),...a}));o.displayName="CardDescription";let l=a.forwardRef(({className:e,...a},s)=>(0,t.jsx)("div",{ref:s,className:(0,r.cn)("py-4 px-(--card-padding-x) border-b last:border-none",e),...a}));l.displayName="CardContent";let d=a.forwardRef(({className:e,...a},s)=>(0,t.jsx)("div",{ref:s,className:(0,r.cn)("flex items-center py-4 px-(--card-padding-x)",e),...a}));d.displayName="CardFooter",e.s(["Card",0,s,"CardContent",0,l,"CardDescription",0,o,"CardFooter",0,d,"CardHeader",0,i,"CardTitle",0,n])},323502,19584,e=>{"use strict";let t=(0,e.i(679709).default)("ArrowDown",[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]]);e.s(["default",0,t],19584),e.s(["ArrowDown",0,t],323502)},146628,e=>{"use strict";let t=(0,e.i(679709).default)("ArrowUp",[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]]);e.s(["ArrowUp",0,t],146628)},394366,e=>{"use strict";let t=(0,e.i(679709).default)("ChevronsUpDown",[["path",{d:"m7 15 5 5 5-5",key:"1hf1tw"}],["path",{d:"m7 9 5-5 5 5",key:"sgt6xg"}]]);e.s(["ChevronsUpDown",0,t],394366)},679367,e=>{"use strict";var t=e.i(221628),a=e.i(416340),r=e.i(843778);let s=a.forwardRef(({className:e,containerClassName:s,children:i,stickyLastColumn:n,outerContainerRef:o,...l},d)=>{let c=a.useRef(null),{hasHorizontalScroll:m,canScrollLeft:p,canScrollRight:f}=(e=>{let[t,r]=a.useState(!1),[s,i]=a.useState(!1),[n,o]=a.useState(!1);return a.useEffect(()=>{let a=e.current;if(!a)return;let s=()=>{let e=a.scrollWidth>a.clientWidth;if(r(e),e){let e=a.scrollLeft>0,t=a.scrollLeft<a.scrollWidth-a.clientWidth;i(e),o(t)}else i(!1),o(!1)},n=()=>{if(t){let e=a.scrollLeft>0,t=a.scrollLeft<a.scrollWidth-a.clientWidth;i(e),o(t)}};return s(),a.addEventListener("scroll",n),window.addEventListener("resize",s),()=>{a.removeEventListener("scroll",n),window.removeEventListener("resize",s)}},[e,t]),{hasHorizontalScroll:t,canScrollLeft:s,canScrollRight:n}})(c),u=(0,r.cn)("[&_td:last-child]:before:absolute [&_td:last-child]:before:top-0 [&_td:last-child]:before:-left-6","[&_td:last-child]:before:bottom-0 [&_td:last-child]:before:w-6 [&_td:last-child]:before:bg-linear-to-l","[&_td:last-child]:before:from-black/5 dark:[&_td:last-child]:before:from-black/20 [&_td:last-child]:before:to-transparent","[&_td:last-child]:before:opacity-0 [&_td:last-child]:before:transition-all [&_td:last-child]:before:duration-400","[&_td:last-child]:before:easing-[0.24, 0.25, 0.05, 1] [&_td:last-child]:before:z-39","[&_th:last-child]:before:absolute [&_th:last-child]:before:top-0 [&_th:last-child]:before:-left-6","[&_th:last-child]:before:bottom-0 [&_th:last-child]:before:w-6 [&_th:last-child]:before:bg-linear-to-l","[&_th:last-child]:before:from-black/5 dark:[&_th:last-child]:before:from-black/20 [&_th:last-child]:before:to-transparent","[&_th:last-child]:before:opacity-0 [&_th:last-child]:before:transition-all [&_th:last-child]:before:duration-400","[&_th:last-child]:before:easing-[0.24, 0.25, 0.05, 1] [&_th:last-child]:before:z-39");return(0,t.jsxs)("div",{ref:o,className:(0,r.cn)(s,"relative"),children:[(0,t.jsx)("div",{className:(0,r.cn)("absolute inset-0 pointer-events-none z-38","before:absolute before:top-0 before:right-0 before:bottom-0 before:w-6 before:bg-linear-to-l before:from-black/5 dark:before:from-black/20 before:to-transparent before:opacity-0 before:transition-all before:duration-400 before:easing-[0.24, 0.25, 0.05, 1]","after:absolute after:top-0 after:left-0 after:bottom-0 after:w-6 after:bg-linear-to-r after:from-black/5 dark:after:from-black/20 after:to-transparent after:opacity-0 after:transition-all after:duration-400 after:easing-[0.24, 0.25, 0.05, 1]",m&&"hover:before:opacity-100 hover:after:opacity-100",f&&"before:opacity-100",p&&"after:opacity-100")}),(0,t.jsx)("div",{ref:c,className:(0,r.cn)("w-full overflow-auto",n&&["[&_tr>*:last-child]:sticky [&_tr>*:last-child]:z-38 [&_tr>*:last-child]:right-0","[&_tr:hover>*:last-child]:bg-transparent","[&_th>*:last-child]:bg-surface-100",u,m&&"[&_tr:hover>td:last-child]:!bg-surface-200"],f&&"[&_td]:before:opacity-100 [&_tr>*:last-child]:before:opacity-100 [&_th:last-child]:before:opacity-100",e),...l,children:i})]})});s.displayName="ShadowScrollArea",e.s(["ShadowScrollArea",0,s],679367)},492418,e=>{"use strict";var t=e.i(221628),a=e.i(323502),r=e.i(146628),s=e.i(394366),i=e.i(416340),n=e.i(843778),o=e.i(679367);let l=i.forwardRef(({className:e,containerProps:a,...r},s)=>(0,t.jsx)(o.ShadowScrollArea,{...a,children:(0,t.jsx)("table",{ref:s,className:(0,n.cn)("group/table w-full caption-bottom text-sm",e),...r})}));l.displayName="Table";let d=i.forwardRef(({className:e,...a},r)=>(0,t.jsx)("thead",{ref:r,className:(0,n.cn)("[&_tr]:border-b [&>tr]:bg-200",e),...a}));d.displayName="TableHeader";let c=i.forwardRef(({className:e,...a},r)=>(0,t.jsx)("tbody",{ref:r,className:(0,n.cn)("[&_tr:last-child]:border-0",e),...a}));c.displayName="TableBody";let m=i.forwardRef(({className:e,...a},r)=>(0,t.jsx)("tfoot",{ref:r,className:(0,n.cn)("border-t font-medium",e),...a}));m.displayName="TableFooter";let p=i.forwardRef(({className:e,...a},r)=>(0,t.jsx)("tr",{ref:r,className:(0,n.cn)("border-b group data-[state=selected]:bg-muted hover:bg-surface-200",e),...a}));p.displayName="TableRow";let f=i.forwardRef(({className:e,...a},r)=>(0,t.jsx)("th",{ref:r,className:(0,n.cn)("h-10 px-4 text-left align-middle heading-meta whitespace-nowrap text-foreground-lighter [&:has([role=checkbox])]:pr-0","transition-colors",e),...a}));function u({column:e,currentSort:i,onSortChange:o,children:l,className:d}){let c,[m,p]=i.split(":"),f=m===e;return(0,t.jsxs)("button",{type:"button",tabIndex:0,className:(0,n.cn)("group/table-head-sort heading-meta whitespace-nowrap flex items-center gap-1 cursor-pointer select-none bg-transparent! border-none p-0 w-full text-left",d),onClick:()=>o(e),children:[l,(0,t.jsx)("div",{className:"w-3 h-3 relative overflow-hidden",children:(c="w-3 h-3 absolute inset-0",(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)(r.ArrowUp,{className:(0,n.cn)(c,"transition-transform",f&&"asc"===p?"translate-y-0":"translate-y-full")}),(0,t.jsx)(a.ArrowDown,{className:(0,n.cn)(c,"transition-transform",f&&"desc"===p?"translate-y-0":"-translate-y-full")}),(0,t.jsx)(s.ChevronsUpDown,{className:(0,n.cn)(c,"transition-opacity opacity-80 md:opacity-40",f?"opacity-0!":"group-hover/table-head-sort:opacity-80")})]}))})]})}f.displayName="TableHead",u.displayName="TableHeadSort";let g=i.forwardRef(({className:e,...a},r)=>(0,t.jsx)("td",{ref:r,className:(0,n.cn)("transition-colors p-4 align-middle [&:has([role=checkbox])]:pr-0",e),...a}));g.displayName="TableCell";let h=i.forwardRef(({className:e,...a},r)=>(0,t.jsx)("caption",{ref:r,className:(0,n.cn)("border-t","p-4 text-sm text-foreground-muted",e),...a}));h.displayName="TableCaption",e.s(["Table",0,l,"TableBody",0,c,"TableCaption",0,h,"TableCell",0,g,"TableFooter",0,m,"TableHead",0,f,"TableHeadSort",0,u,"TableHeader",0,d,"TableRow",0,p])},108151,e=>{"use strict";var t=e.i(221628),a=e.i(416340),r=e.i(627069),s=e.i(843778),i=e.i(492418);let n=(0,a.forwardRef)(({className:e,style:a,delayIndex:r=0,animationDelay:i=150},n)=>(0,t.jsx)("div",{ref:n,className:(0,s.cn)("shimmering-loader rounded-sm py-3",e),style:{...a,animationFillMode:"backwards",animationDelay:`${r*i}ms`}}));n.displayName="ShimmeringLoader",e.s(["GenericSkeletonLoader",0,({className:e})=>(0,t.jsxs)("div",{className:(0,s.cn)(e,"space-y-2"),children:[(0,t.jsx)(n,{}),(0,t.jsx)(n,{className:"w-3/4"}),(0,t.jsx)(n,{className:"w-1/2"})]}),"GenericTableLoader",0,({headers:e=[],numRows:a=3})=>(0,t.jsx)(r.Card,{children:(0,t.jsxs)(i.Table,{children:[(0,t.jsx)(i.TableHeader,{children:(0,t.jsx)(i.TableRow,{children:0===e.length?(0,t.jsx)(i.TableHead,{}):e.map((e,a)=>(0,t.jsx)(i.TableHead,{children:e},`${e}_${a}`))})}),(0,t.jsx)(i.TableBody,{children:Array(a).fill(0).map((a,r)=>(0,t.jsx)(i.TableRow,{children:(0,t.jsx)(i.TableCell,{colSpan:e.length,children:(0,t.jsx)(n,{})})},`row_${r}`))})]})}),"ShimmeringLoader",0,n])},478372,602795,e=>{"use strict";let t=(0,e.i(679709).default)("X",[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]);e.s(["default",0,t],602795),e.s(["X",0,t],478372)},606479,e=>{"use strict";var t=e.i(546904);e.s(["Dialog",0,t])},253214,e=>{"use strict";var t=e.i(221628),a=e.i(766181),r=e.i(478372),s=e.i(606479),i=e.i(416340),n=e.i(843778),o=e.i(106);let l="py-4",d="px-4 md:px-5",c="py-6",m="px-4 md:px-7",p=(0,a.cva)("",{variants:{padding:{medium:`${c} ${m}`,small:`${l} ${d}`}},defaultVariants:{padding:"small"}}),f=s.Dialog.Root,u=i.forwardRef(({disabled:e,tabIndex:a,...r},i)=>{let n=(0,o.getExplicitTabIndex)(a,e);return(0,t.jsx)(s.Dialog.Trigger,{ref:i,...r,disabled:e,tabIndex:n})});u.displayName=s.Dialog.Trigger.displayName;let g=e=>(0,t.jsx)(s.Dialog.Portal,{...e});g.displayName=s.Dialog.Portal.displayName;let h=i.forwardRef(({className:e,centered:a=!0,...r},i)=>(0,t.jsx)(s.Dialog.Overlay,{ref:i,className:(0,n.cn)("bg-black/40 backdrop-blur-xs","z-50 fixed inset-0 grid place-items-center overflow-y-auto data-closed:animate-overlay-hide py-8",!a&&"flex flex-col flex-start pb-8 sm:pt-12 md:pt-20 lg:pt-32 xl:pt-40 px-5",e),...r}));h.displayName=s.Dialog.Overlay.displayName;let b=(0,a.cva)((0,n.cn)("relative z-50 w-full max-w-screen border shadow-md dark:shadow-xs","data-[state=open]:animate-in data-[state=closed]:animate-out","data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95","data-[state=closed]:slide-out-to-left-[0%] data-[state=closed]:slide-out-to-top-[0%]","data-[state=open]:slide-in-from-left-[0%] data-[state=open]:slide-in-from-top-[0%]","sm:rounded-lg md:w-full","bg-dash-sidebar"),{variants:{size:{tiny:"sm:align-middle sm:w-full sm:max-w-xs",small:"sm:align-middle sm:w-full sm:max-w-sm",medium:"sm:align-middle sm:w-full sm:max-w-lg",large:"sm:align-middle sm:w-full md:max-w-xl",xlarge:"sm:align-middle sm:w-full md:max-w-3xl",xxlarge:"sm:align-middle sm:w-full md:max-w-6xl",xxxlarge:"sm:align-middle sm:w-full md:max-w-7xl"}},defaultVariants:{size:"medium"}}),y=i.forwardRef(({className:e,children:a,size:i,hideClose:o,dialogOverlayProps:l,centered:d=!0,...c},m)=>(0,t.jsx)(g,{children:(0,t.jsx)(h,{centered:d,...l,children:(0,t.jsxs)(s.Dialog.Content,{ref:m,className:(0,n.cn)(b({size:i}),e),...c,children:[a,!o&&(0,t.jsxs)(s.Dialog.Close,{className:(0,n.cn)("absolute p-0.5 right-3.5 top-3.5 rounded-xs opacity-20 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-foreground-muted","hit-area-6"),children:[(0,t.jsx)(r.X,{size:16}),(0,t.jsx)("span",{className:"sr-only",children:"Close"})]})]})})}));y.displayName=s.Dialog.Content.displayName;let w=i.forwardRef(({className:e,padding:a,...r},s)=>(0,t.jsx)("div",{ref:s,...r,className:(0,n.cn)("flex flex-col gap-1.5 text-center sm:text-left",p({padding:a}),e)}));w.displayName="DialogHeader";let _=i.forwardRef(({className:e,children:a,padding:r,...s},i)=>(0,t.jsx)("div",{ref:i,className:(0,n.cn)("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2","border-t",p({padding:r}),e),...s,children:a}));_.displayName="DialogFooter";let x=i.forwardRef(({className:e,...a},r)=>(0,t.jsx)(s.Dialog.Title,{ref:r,className:(0,n.cn)("text-base leading-none font-normal max-w-[calc(100%-1rem)]",e),...a}));x.displayName=s.Dialog.Title.displayName;let v=i.forwardRef(({className:e,...a},r)=>(0,t.jsx)(s.Dialog.Description,{ref:r,className:(0,n.cn)("text-sm text-foreground-lighter",e),...a}));v.displayName=s.Dialog.Description.displayName;let S=i.forwardRef(({className:e,children:a,...r},i)=>(0,t.jsx)(s.Dialog.Close,{ref:i,className:(0,n.cn)("opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-foreground-muted",e),...r,children:a}));S.displayName=s.Dialog.Close.displayName;let j=i.forwardRef(({className:e,children:a,padding:r,...s},i)=>(0,t.jsx)("div",{ref:i,...s,className:(0,n.cn)(p({padding:r}),"overflow-hidden",e),children:a}));j.displayName="DialogSection";let N=i.forwardRef(({className:e,children:a,...r},s)=>(0,t.jsx)("div",{ref:s,...r,className:(0,n.cn)("w-full h-px bg-border",e)}));N.displayName="DialogSectionSeparator",e.s(["DIALOG_PADDING_X",0,m,"DIALOG_PADDING_X_SMALL",0,d,"DIALOG_PADDING_Y",0,c,"DIALOG_PADDING_Y_SMALL",0,l,"Dialog",0,f,"DialogClose",0,S,"DialogContent",0,y,"DialogDescription",0,v,"DialogFooter",0,_,"DialogHeader",0,w,"DialogSection",0,j,"DialogSectionSeparator",0,N,"DialogTitle",0,x,"DialogTrigger",0,u])},681328,e=>{"use strict";e.s(["EMPTY_ARR",0,[],"EMPTY_OBJ",0,{},"noop",0,function(){}])},4517,e=>{"use strict";var t=e.i(201844);function a(e,{pages:t,pageParams:r}){let s=t.length-1;return t.length>0?e.getNextPageParam(t[s],t,r[s],r):void 0}function r(e,{pages:t,pageParams:a}){return t.length>0?e.getPreviousPageParam?.(t[0],t,a[0],a):void 0}e.s(["hasNextPage",0,function(e,t){return!!t&&null!=a(e,t)},"hasPreviousPage",0,function(e,t){return!!t&&!!e.getPreviousPageParam&&null!=r(e,t)},"infiniteQueryBehavior",0,function(e){return{onFetch:(s,i)=>{let n=s.options,o=s.fetchOptions?.meta?.fetchMore?.direction,l=s.state.data?.pages||[],d=s.state.data?.pageParams||[],c={pages:[],pageParams:[]},m=0,p=async()=>{let i=!1,p=(0,t.ensureQueryFn)(s.options,s.fetchOptions),f=async(e,a,r)=>{let n;if(i)return Promise.reject();if(null==a&&e.pages.length)return Promise.resolve(e);let o=(Object.defineProperty(n={client:s.client,queryKey:s.queryKey,pageParam:a,direction:r?"backward":"forward",meta:s.options.meta},"signal",{enumerable:!0,get:()=>(s.signal.aborted?i=!0:s.signal.addEventListener("abort",()=>{i=!0}),s.signal)}),n),l=await p(o),{maxPages:d}=s.options,c=r?t.addToStart:t.addToEnd;return{pages:c(e.pages,l,d),pageParams:c(e.pageParams,a,d)}};if(o&&l.length){let e="backward"===o,t={pages:l,pageParams:d},s=(e?r:a)(n,t);c=await f(t,s,e)}else{let t=e??l.length;do{let e=0===m?d[0]??n.initialPageParam:a(n,c);if(m>0&&null==e)break;c=await f(c,e),m++}while(m<t)}return c};s.options.persister?s.fetchFn=()=>s.options.persister?.(p,{client:s.client,queryKey:s.queryKey,meta:s.options.meta,signal:s.signal},i):s.fetchFn=p}}}])},78162,e=>{"use strict";e.s(["configKeys",0,{settings:e=>["projects",e,"settings"],settingsV2:e=>["projects",e,"settings-v2"],api:e=>["projects",e,"settings","api"],postgrest:e=>["projects",e,"postgrest"],jwtSecretUpdatingStatus:e=>["projects",e,"jwt-secret-updating-status"],storage:e=>["projects",e,"storage"],upgradeEligibility:e=>["projects",e,"upgrade-eligibility"],upgradeStatus:e=>["projects",e,"upgrade-status"],diskAttributes:e=>["projects",e,"disk-attributes"],diskBreakdown:e=>["projects",e,"disk-breakdown"],diskUtilization:e=>["projects",e,"disk-utilization"],projectCreationPostgresVersions:(e,t,a)=>["projects",e,t,a,"available-creation-versions"],projectUnpausePostgresVersions:e=>["projects",e,"available-unpause-versions"],diskAutoscaleConfig:e=>["projects",e,"disk-autoscale-config"],deploymentMode:()=>["deployment-mode"],postgresConfig:e=>["projects",e,"postgres-config"]}])}]);

//# debugId=226a739e-4eca-cc50-0cf8-b6dba1a587a1