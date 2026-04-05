import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function checkModels() {
  const models = await genAI.genAI.listModels();
  for (const model of models) {
    console.log(model.name);
  }
}

async function testEmbedding() {
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const res = await model.embedContent('hello');
    console.log('text-embedding-004 works!');
  } catch (e) {
    console.error('err with text-embedding-004:', e.message);
  }
  try {
    const model = genAI.getGenerativeModel({ model: 'embedding-001' });
    const res = await model.embedContent('hello');
    console.log('embedding-001 works!');
  } catch (e) {
    console.error('err with embedding-001:', e.message);
  }
}
testEmbedding();
