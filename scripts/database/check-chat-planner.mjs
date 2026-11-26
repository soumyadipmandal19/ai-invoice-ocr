// Real planner -> fixed Neo4j queries -> deterministic answer. All fixtures roll back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='server-only')return {url:'data:text/javascript,',shortCircuit:true};
  if(specifier.startsWith('@/'))return nextResolve(new URL(`../../${specifier.slice(2)}.ts`,import.meta.url).href,context);
  return nextResolve(specifier,context);
}});
const {getNeo4jDriver}=await import('../../lib/server/database/neo4j.ts');
const {answerDocumentQuestion}=await import('../../lib/server/chat/service.ts');
let driver,session,transaction;
try {
  driver=getNeo4jDriver();
  session=driver.session({database:process.env.NEO4J_DATABASE||'neo4j'});
  transaction=session.beginTransaction({timeout:120_000});
  const ownerUserId=`planner-check-${randomUUID()}`;
  const foreignOwner=`planner-foreign-${randomUUID()}`;
  const dates=['2012-06-12','2016-01-25','2012-02-02','2012-08-29','2026-11-06','2026-10-17'];
  const vendors=['SuperStore','DEMO - Sliced Invoices','SuperStore','SuperStore',null,'Swaad Rasoi Family Restaurant'];
  for(const [index,billDate] of dates.entries())await transaction.run(
    `MERGE (u:User {id:$ownerUserId})
     CREATE (u)-[:UPLOADED]->(:Bill {billId:$billId, sourceFile:$fileName, billDate:$billDate,
       vendorName:$vendor, billNumber:$billNumber, balanceDue:0.0,
       totalAmount:100.0, currency:'INR', notes:$notes})`,
    {ownerUserId,billId:randomUUID(),fileName:`synthetic-${index}.pdf`,billDate,
      vendor:vendors[index],billNumber:index===4?'HE27191004419016':`TEST-${index}`,
      notes:index===4?'Billing history mentions August 2026':'Synthetic fixture'});
  await transaction.run(
    `CREATE (:User {id:$owner})-[:UPLOADED]->(:Bill {billId:$billId, sourceFile:'foreign.pdf', billDate:'2012-08-01'})`,
    {owner:foreignOwner,billId:randomUUID()});
  globalThis.auraDriver={executeQuery(query,params){
    assert.equal(params.ownerUserId,ownerUserId);
    assert.ok(!/\b(CREATE|MERGE|SET|DELETE|CALL)\b/.test(query));
    return transaction.run(query,params);
  }};
  const august=await answerDocumentQuestion(ownerUserId,'how many files are from august month?',[]);
  assert.match(august.answer,/1 saved file/);assert.match(august.answer,/2012-08-29/);
  assert.doesNotMatch(august.answer,/foreign|synthetic-4/);assert.deepEqual(august.sources,[]);assert.equal(august.model,null);
  const wrongYear=await answerDocumentQuestion(ownerUserId,'How many invoices have a bill date in August 2026?',[]);
  assert.match(wrongYear.answer,/0 saved files/);
  const count=await answerDocumentQuestion(ownerUserId,'Give me a tally of my saved documents',[]);
  assert.equal(count.answer,'You have 6 saved bills.');
  const oldest=await answerDocumentQuestion(ownerUserId,'Which bill is the oldest?',[]);
  assert.match(oldest.answer,/2012-02-02/);assert.doesNotMatch(oldest.answer,/2012-08-29/);
  const missingVendor=await answerDocumentQuestion(ownerUserId,"which document's vendor is missing",[]);
  assert.match(missingVendor.answer,/HE27191004419016/);assert.match(missingVendor.answer,/2026-11-06/);
  assert.doesNotMatch(missingVendor.answer,/synthetic-0|synthetic-1|synthetic-2|synthetic-3|synthetic-5/);
  assert.deepEqual(missingVendor.sources,[]);assert.equal(missingVendor.model,null);
  const presentVendor=await answerDocumentQuestion(ownerUserId,'How many documents have a vendor filled in?',[]);
  assert.match(presentVendor.answer,/5 saved files/);
  const missingAmount=await answerDocumentQuestion(ownerUserId,'List invoices without a total amount',[]);
  assert.match(missingAmount.answer,/No matching saved files/);
  console.log(JSON.stringify({realPlanner:true,realNeo4j:true,billDateCount:true,monthAcrossYears:true,
    explicitYear:true,naturalCount:true,dateRanking:true,missingVendor:true,presentVendor:true,missingAmount:true,
    ownerIsolation:true,syntheticOnly:true,fixtureRollback:true}));
} catch(error) {
  console.error('Chat planner check failed:',error.code||error.name);
  if(error.code==='ERR_ASSERTION')console.error(error.message);
  if(error.name==='ChatModelError')console.error(error.message);
  process.exitCode=1;
} finally {
  globalThis.auraDriver=driver;
  if(transaction)await transaction.rollback();
  if(session)await session.close();
  if(driver)await driver.close();
}
