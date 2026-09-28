// Transcrição de áudio dos clientes (WhatsApp / Direct / Messenger).
// Usa a API de transcrição da OpenAI (variável OPENAI_API_KEY no Netlify).
// Sem a chave, não faz nada — a IA segue pedindo para o cliente escrever.
const MODELO = process.env.TRANSCRICAO_MODELO || 'gpt-4o-mini-transcribe';
const EXT = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/wav': 'wav', 'audio/webm': 'webm' };

const disponivel = () => !!process.env.OPENAI_API_KEY;

async function transcrever({ buf, mime }) {
  if (!disponivel()) return null;
  const tipo = String(mime || 'audio/ogg').split(';')[0];
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: tipo }), `audio.${EXT[tipo] || 'ogg'}`);
  fd.append('model', MODELO);
  fd.append('language', 'pt');
  fd.append('response_format', 'json');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`transcrição ${r.status}: ${(j.error && j.error.message) || ''}`.slice(0, 200));
  return String(j.text || '').trim() || null;
}
module.exports = { transcrever, disponivel };
