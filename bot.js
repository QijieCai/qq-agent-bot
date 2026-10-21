import WebSocket from 'ws'

const APP_ID = process.env.QQ_APP_ID
const APP_SECRET = process.env.QQ_APP_SECRET
const MY_OPENID = process.env.MY_QQ_OPENID || ''
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY
const MODEL = process.env.BAILIAN_MODEL || 'qwen3.8-flash'
const GATEWAY = 'https://api.sgroup.qq.com'

if (!APP_ID || !APP_SECRET || !DASHSCOPE_API_KEY) throw new Error('Missing required environment variables')

async function getToken () {
  const r = await fetch('https://bots.qq.com/app/getAppAccessToken', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({appId: APP_ID, clientSecret: APP_SECRET}) })
  const j = await r.json()
  if (!r.ok || !j.access_token) throw new Error('QQ token error: ' + JSON.stringify(j))
  return j.access_token
}

async function askBailian (text) {
  const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + DASHSCOPE_API_KEY}, body: JSON.stringify({model: MODEL, messages: [{role: 'system', content: '你是我的私人 QQ 助手。回答简洁、准确。'}, {role: 'user', content: text}]}) })
  const j = await r.json()
  if (!r.ok) throw new Error('Bailian error: ' + JSON.stringify(j))
  return j.choices?.[0]?.message?.content || '暂时没有得到有效回答。'
}

async function reply (token, openid, msgId, content) {
  const r = await fetch(GATEWAY + '/v2/users/' + openid + '/messages', { method: 'POST', headers: {'content-type': 'application/json', authorization: 'QQBot ' + token}, body: JSON.stringify({content: content.slice(0, 4000), msg_type: 0, msg_id: msgId, msg_seq: 1}) })
  if (!r.ok) console.error('QQ reply error', r.status, await r.text())
}

async function connect () {
  const token = await getToken()
  const gr = await fetch(GATEWAY + '/gateway', {headers: {authorization: 'QQBot ' + token}})
  const {url} = await gr.json()
  const ws = new WebSocket(url)
  let seq = null
  let heartbeat
  ws.on('message', async raw => {
    const p = JSON.parse(raw)
    if (p.s != null) seq = p.s
    if (p.op === 10) {
      heartbeat = setInterval(() => ws.send(JSON.stringify({op: 1, d: seq})), p.d.heartbeat_interval)
      ws.send(JSON.stringify({op: 2, d: {token: 'QQBot ' + token, intents: 1 << 25, shard: [0, 1]}}))
      console.log('QQ gateway connected')
    } else if (p.op === 0 && p.t === 'C2C_MESSAGE_CREATE') {
      const openid = p.d.author?.id
      const text = (p.d.content || '').trim()
      console.log('message from', openid, text)
      if (!text || (MY_OPENID && openid !== MY_OPENID)) return
      try { await reply(token, openid, p.d.id, await askBailian(text)) }
      catch (e) { console.error(e); await reply(token, openid, p.d.id, '处理请求时出错，请稍后再试。') }
    }
  })
  ws.on('close', () => { clearInterval(heartbeat); setTimeout(connect, 5000) })
  ws.on('error', e => console.error('WebSocket error', e.message))
}
connect().catch(e => { console.error(e); setTimeout(connect, 5000) })
