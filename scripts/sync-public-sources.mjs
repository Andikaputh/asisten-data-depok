import {createStore} from '../server/store.js';
import {syncPublicSources,importPublicWasteCsv} from '../server/public-sources.js';
const store=createStore();
try {const results=await syncPublicSources(store);if(process.argv.includes('--include-csv')){try{results.push(await importPublicWasteCsv(store));}catch(error){results.push({key:'observasi-sampah',error:error.message});}}console.log(JSON.stringify(results,null,2));if(results.some(result=>result.error))process.exitCode=1;}
finally{store.close();}
