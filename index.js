/**
 * WILIB Dispatch Server v2
 * Sistèm Rezèvasyon Sèlman — Massachusetts 20+ mil
 */

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

const BOT_TOKEN    = process.env.BOT_TOKEN;
const ADMIN_ID     = process.env.ADMIN_CHAT_ID;
const PORT         = process.env.PORT || 3000;
const TIMEOUT_MIN  = 30;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🚗 WILIB Server starting...');

// Timeout aktif: { reservationId: timer }
const activeTimers = {};

// Kòdone vil
const CITIES = {
  'boston':[42.3601,-71.0589],'worcester':[42.2626,-71.8023],'springfield':[42.1015,-72.5898],
  'lowell':[42.6334,-71.3162],'brockton':[42.0834,-71.0184],'cambridge':[42.3736,-71.1097],
  'new bedford':[41.6362,-70.9342],'quincy':[42.2529,-71.0023],'lynn':[42.4668,-70.9495],
  'fall river':[41.7015,-71.1550],'lawrence':[42.7070,-71.1631],'haverhill':[42.7762,-71.0773],
  'malden':[42.4251,-71.0662],'medford':[42.4184,-71.1062],'waltham':[42.3765,-71.2356],
  'peabody':[42.5279,-70.9287],'revere':[42.4079,-71.0120],'methuen':[42.7262,-71.1906],
  'taunton':[41.9001,-71.0898],'everett':[42.4084,-71.0537],'salem':[42.5195,-70.8967],
  'leominster':[42.5251,-71.7598],'fitchburg':[42.5834,-71.8029],'beverly':[42.5584,-70.8800],
  'holyoke':[42.2042,-72.6162],'marlborough':[42.3487,-71.5523],'chelsea':[42.3918,-71.0328],
  'danvers':[42.5751,-70.9301],'attleboro':[41.9445,-71.2956],'pittsfield':[42.4501,-73.2454],
  'mattapan':[42.2726,-71.0922],'roxbury':[42.3112,-71.0870],'dorchester':[42.3001,-71.0668],
  'providence':[41.8240,-71.4128],'hartford':[41.7658,-72.6851],
  'manchester':[42.9956,-71.4548],'nashua':[42.7654,-71.4676],'new york':[40.7128,-74.0060],
};

function getCoords(city) {
  const words = city.toLowerCase().split(/[\s,]+/);
const states = ['ma','nh','ct','ri','ny','massachusetts'];
for (let i = words.length - 1; i >= 0; i--) {
  if (states.includes(words[i])) continue;
  if (!words[i].match(/^\d+$/)) {
    const k = words[i];
    if (CITIES[k]) return CITIES[k];
  }
}
const k = city.toLowerCase().replace(/,?\s*(ma|nh|ct|ri|ny|massachusetts)\s*$/i,'').trim();
return CITIES[k] || null;
}

function haversine(lat1,lng1,lat2,lng2) {
  const R=3958.8, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

async function notifyAdmin(msg) {
  try { await bot.sendMessage(ADMIN_ID, msg); } catch(e) { console.error('Admin notify error:', e.message); }
}

// ===== DISPATCH ENGINE =====
async function dispatch(resId, excludeIds=[]) {
  const { data: res } = await supabase.from('reservations').select('*').eq('id', resId).single();
  if (!res) return;

  const coords = getCoords(res.from_city);
  if (!coords) { await notifyAdmin(`⚠️ Vil "${res.from_city}" pa nan sistèm pou rezèvasyon #${resId}`); return; }

  const { data: drivers } = await supabase.from('drivers').select('*').eq('status','active');
  if (!drivers?.length) { await notifyAdmin(`⚠️ Pa gen chofè aktif pou rezèvasyon #${resId}`); return; }

  const candidates = drivers
    .filter(d => !excludeIds.includes(d.id))
    .map(d => ({ ...d, dist: haversine(coords[0], coords[1], d.lat, d.lng) }))
    .sort((a,b) => a.dist - b.dist);

  if (!candidates.length) {
    await supabase.from('reservations').update({ status:'cancelled' }).eq('id', resId);
    await notifyAdmin(`❌ Tout chofè refize #${resId} — Rezèvasyon anile.`);
    return;
  }

  const driver = candidates[0];

  await supabase.from('reservations').update({ status:'dispatched', driver_id: driver.id }).eq('id', resId);
  await supabase.from('dispatch_log').insert({ reservation_id: resId, driver_id: driver.id, action:'sent' });

  const msg =
    `🔔 WILIB — NOUVO REZÈVASYON #${resId}\n\n`+
    `👤 Kliyan: ${res.client_name}\n`+
    `📞 Telefòn: ${res.client_phone}\n`+
    `📍 Depa: ${res.from_city}\n`+
    `🏁 Destinasyon: ${res.to_city}\n`+
    `👥 Pasaje: ${res.passengers}\n`+
    `📅 Dat: ${res.trip_date}\n`+
    `🕐 Lè: ${res.trip_time}\n`+
    `📏 Distans depi ou: ${driver.dist.toFixed(1)} mil\n\n`+
    `⏱️ Ou gen ${TIMEOUT_MIN} minit pou reponn.\n\n`+
    `✅ Aksepte: /aksepte_${resId}\n`+
    `❌ Refize: /refize_${resId}`;

  await bot.sendMessage(driver.telegram_id, msg);
  console.log(`📤 Dispatch #${resId} → ${driver.name} (${driver.dist.toFixed(1)} mi)`);

  // Timeout 30 minit
  activeTimers[resId] = setTimeout(async () => {
    const { data: current } = await supabase.from('reservations').select('status').eq('id',resId).single();
    if (current?.status === 'dispatched') {
      await supabase.from('dispatch_log').insert({ reservation_id:resId, driver_id:driver.id, action:'timeout' });
      await bot.sendMessage(driver.telegram_id, `⏰ Tan ou ekspire pou rezèvasyon #${resId}.`);
      dispatch(resId, [...excludeIds, driver.id]);
    }
    delete activeTimers[resId];
  }, TIMEOUT_MIN * 60 * 1000);
}

// ===== TELEGRAM BOT =====
const sessions = {}; // enskripsyon chofè

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const { data: existing } = await supabase.from('drivers').select('*').eq('telegram_id', chatId).single();
  if (existing) {
    bot.sendMessage(chatId,
      `✅ Ou deja anrejistre!\n\n👤 ${existing.name}\n🚗 ${existing.vehicle}\n📍 ${existing.city}\n\n`+
      `Kòmand:\n/active — Disponib\n/inactive — Pa disponib\n/status — Wè profil ou`);
    return;
  }
  sessions[chatId] = { step:'name', data:{} };
  bot.sendMessage(chatId, `👋 Byenveni nan WILIB Dispatch!\n\nTape non konplè ou (Prenon + Siyati):`);
});

bot.onText(/\/aksepte_(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const resId = parseInt(match[1]);
  const { data: driver } = await supabase.from('drivers').select('*').eq('telegram_id',chatId).single();
  if (!driver) return;
  const { data: res } = await supabase.from('reservations').select('*').eq('id',resId).single();
  if (!res || res.status !== 'dispatched') {
    bot.sendMessage(chatId, `⚠️ Rezèvasyon #${resId} pa disponib ankò.`); return;
  }
  if (activeTimers[resId]) { clearTimeout(activeTimers[resId]); delete activeTimers[resId]; }
  await supabase.from('reservations').update({ status:'confirmed' }).eq('id',resId);
  await supabase.from('dispatch_log').insert({ reservation_id:resId, driver_id:driver.id, action:'accepted' });
  bot.sendMessage(chatId,
    `✅ Rezèvasyon #${resId} aksepte!\n\n`+
    `👤 ${res.client_name} — 📞 ${res.client_phone}\n`+
    `📍 ${res.from_city} → 🏁 ${res.to_city}\n`+
    `📅 ${res.trip_date} — 🕐 ${res.trip_time}\n\n`+
    `Kontakte kliyan an pou konfirme.`);
  await notifyAdmin(`✅ Rezèvasyon #${resId} konfime!\n🚗 ${driver.name}\n👤 ${res.client_name} (${res.client_phone})`);
});

bot.onText(/\/refize_(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const resId = parseInt(match[1]);
  const { data: driver } = await supabase.from('drivers').select('*').eq('telegram_id',chatId).single();
  if (!driver) return;
  if (activeTimers[resId]) { clearTimeout(activeTimers[resId]); delete activeTimers[resId]; }
  await supabase.from('dispatch_log').insert({ reservation_id:resId, driver_id:driver.id, action:'declined' });
  bot.sendMessage(chatId, `❌ Ou refize rezèvasyon #${resId}. Mèsi.`);
  dispatch(resId, [driver.id]);
});

bot.onText(/\/active/, async (msg) => {
  await supabase.from('drivers').update({ status:'active' }).eq('telegram_id', msg.chat.id);
  bot.sendMessage(msg.chat.id, '🟢 Ou disponib kounye a pou resevwa rezèvasyon!');
});

bot.onText(/\/inactive/, async (msg) => {
  await supabase.from('drivers').update({ status:'inactive' }).eq('telegram_id', msg.chat.id);
  bot.sendMessage(msg.chat.id, '🔴 Ou makye kòm pa disponib.');
});

bot.onText(/\/status/, async (msg) => {
  const { data: d } = await supabase.from('drivers').select('*').eq('telegram_id',msg.chat.id).single();
  if (!d) { bot.sendMessage(msg.chat.id, '❌ Ou pa anrejistre. Tape /start'); return; }
  bot.sendMessage(msg.chat.id,
    `📊 Pwofil ou:\n\n👤 ${d.name}\n🚗 ${d.vehicle}\n📍 ${d.city}\n📞 ${d.phone}\n`+
    `👥 Kapasite: ${d.capacity} pasaje\n`+
    `${d.status==='active'?'🟢 Disponib':'🔴 Pa disponib'}`);
});

// Traite etap enskripsyon
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;
  const session = sessions[chatId];
  if (!session) return;

  switch(session.step) {
    case 'name':
      if (text.trim().split(' ').length < 2) { bot.sendMessage(chatId,'⚠️ Ekri non konplè (Prenon + Siyati):'); return; }
      session.data.name = text.trim(); session.step = 'phone';
      bot.sendMessage(chatId, `✅ Non: ${session.data.name}\n\n📞 Nimewo telefòn ou:`); break;

    case 'phone':
      session.data.phone = text.trim(); session.step = 'city';
      bot.sendMessage(chatId, `✅ Telefòn: ${session.data.phone}\n\n📍 Ki vil ou baze? (ex: Brockton, MA)`); break;

    case 'city':
      const coords = getCoords(text.trim());
      if (!coords) { bot.sendMessage(chatId,'⚠️ Vil sa pa nan sistèm nou. Eseye: Boston, Brockton, Worcester...'); return; }
      session.data.city = text.trim(); session.data.lat = coords[0]; session.data.lng = coords[1];
      session.step = 'vehicle';
      bot.sendMessage(chatId, `✅ Vil: ${session.data.city}\n\n🚗 Ki machin ou genyen? (ex: Toyota Sienna 2022)`); break;

    case 'vehicle':
      session.data.vehicle = text.trim(); session.step = 'capacity';
      bot.sendMessage(chatId, `✅ Machin: ${session.data.vehicle}\n\n👥 Konbyen pasaje machin ou ka pran?`); break;

    case 'capacity':
      const cap = parseInt(text);
      if (!cap||cap<1||cap>20) { bot.sendMessage(chatId,'⚠️ Mete nimewo valid (1-20):'); return; }
      session.data.capacity = cap;
      const { error } = await supabase.from('drivers').insert({
        telegram_id: chatId, name: session.data.name, phone: session.data.phone,
        city: session.data.city, lat: session.data.lat, lng: session.data.lng,
        vehicle: session.data.vehicle, capacity: cap, status:'active'
      });
      if (error) { bot.sendMessage(chatId,'❌ Erè. Eseye ankò pita.'); console.error(error); return; }
      delete sessions[chatId];
      bot.sendMessage(chatId,
        `🎉 Enskripsyon konplè!\n\n👤 ${session.data.name}\n📍 ${session.data.city}\n`+
        `🚗 ${session.data.vehicle} (${cap} pasaje)\n📞 ${session.data.phone}\n\n`+
        `✅ Ou disponib pou resevwa rezèvasyon!\n\nKòmand:\n/active /inactive /status`);
      await notifyAdmin(`🆕 NOUVO CHOFÈ!\n👤 ${session.data.name}\n📍 ${session.data.city}\n🚗 ${session.data.vehicle}\n📞 ${session.data.phone}\n🆔 ${chatId}`);
      break;
  }
});

// ===== API =====
app.post('/api/reservations', async (req, res) => {
  const { client_name, client_phone, from_city, to_city, passengers, trip_date, trip_time } = req.body;
  if (!client_name||!client_phone||!from_city||!to_city||!trip_date||!trip_time)
    return res.status(400).json({ error:'Tout chan yo obligatwa.' });

  const coords = getCoords(from_city);
  const { data, error } = await supabase.from('reservations').insert({
    client_name, client_phone, from_city, to_city,
    from_lat: coords?.[0], from_lng: coords?.[1],
    passengers: parseInt(passengers)||1,
    trip_date, trip_time, status:'pending'
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  dispatch(data.id); // Kòmanse dispatch otomatik
  res.json({ success:true, reservation_id: data.id,
    message:`Rezèvasyon #${data.id} resevwa! Nou ap jwenn yon chofè pou ou.` });
});

app.get('/api/reservations', async (req, res) => {
  const { data } = await supabase.from('reservations')
    .select('*, drivers(name,phone,vehicle)').order('created_at',{ascending:false}).limit(200);
  res.json(data||[]);
});

app.get('/api/drivers', async (req, res) => {
  const { data } = await supabase.from('drivers').select('*').order('created_at',{ascending:false});
  res.json(data||[]);
});

app.put('/api/drivers/:id', async (req, res) => {
  const { data, error } = await supabase.from('drivers').update(req.body).eq('id',req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/drivers/:id', async (req, res) => {
  const { error } = await supabase.from('drivers').delete().eq('id',req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success:true });
});

app.get('/api/health', (_req, res) => res.json({ status:'ok', uptime: Math.floor(process.uptime())+'s' }));

app.listen(PORT, () => console.log(`✅ WILIB running on port ${PORT}`));
