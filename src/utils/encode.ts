import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);

export async function encodeRequestBody(body: object): Promise<string> {
  const jsonString = JSON.stringify(body);
  const compressed = await gzip(jsonString);
  return compressed.toString('base64');
}
