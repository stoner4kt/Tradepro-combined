import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { authToken } from './helpers.js';

describe('Tenant isolation across CRM resources',()=>{
 it('prevents a second tenant from reading, updating, deleting or linking another tenant resources',async()=>{
  const app=createApp();
  const a=await authToken(app,'tenant-a@example.test');
  const b=await authToken(app,'tenant-b@example.test');
  const authA={Authorization:'Bearer '+a},authB={Authorization:'Bearer '+b};

  const lead=await request(app).post('/api/leads').set(authA).send({email:'private-lead@example.test',firstName:'Private'});
  const clientA=await request(app).post('/api/clients').set(authA).send({email:'private-client@example.test',firstName:'Private'});
  const clientB=await request(app).post('/api/clients').set(authB).send({email:'tenant-b-client@example.test',firstName:'Other'});
  expect(lead.status).toBe(201);expect(clientA.status).toBe(201);expect(clientB.status).toBe(201);

  const project=await request(app).post('/api/projects').set(authA).send({clientId:clientA.body.client.id,title:'Private project'});
  expect(project.status).toBe(201);

  const leadId=lead.body.lead.id,clientId=clientA.body.client.id,projectId=project.body.project.id;
  expect((await request(app).get('/api/leads/'+leadId).set(authB)).status).toBe(404);
  expect((await request(app).patch('/api/leads/'+leadId).set(authB).send({firstName:'stolen'})).status).toBe(404);
  expect((await request(app).delete('/api/leads/'+leadId).set(authB)).status).toBe(404);
  expect((await request(app).get('/api/clients/'+clientId).set(authB)).status).toBe(404);
  expect((await request(app).patch('/api/clients/'+clientId).set(authB).send({firstName:'stolen'})).status).toBe(404);
  expect((await request(app).delete('/api/clients/'+clientId).set(authB)).status).toBe(404);
  expect((await request(app).patch('/api/projects/'+projectId).set(authB).send({title:'stolen'})).status).toBe(404);
  expect((await request(app).post('/api/projects').set(authB).send({clientId,title:'cross tenant'})).status).toBe(404);
  expect((await request(app).patch('/api/projects/'+projectId).set(authA).send({clientId:clientB.body.client.id})).status).toBe(404);

  expect((await request(app).get('/api/leads/'+leadId).set(authA)).status).toBe(200);
  expect((await request(app).get('/api/clients/'+clientId).set(authA)).status).toBe(200);
 });
});
