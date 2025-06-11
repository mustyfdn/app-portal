require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const fetch = require('node-fetch').default;  // CommonJS için .default ekliyoruz

const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_SECRET = process.env.SESSION_SECRET;
const DATABASE_URL   = process.env.DATABASE_URL;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Gerekli ortam değişkenlerinin kontrolü
if (!DATABASE_URL || !SESSION_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error('Eksik ortam değişkenleri! Uygulama başlatılamıyor.');
  process.exit(1);
}

// Orta katmanlar: JSON body, urlencoded, CORS ve session yönetimi
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // Üretimde: cookie secure, httpOnly gibi ek ayarlar ekleyin.
}));

// Statik dosyaları public klasöründen sunuyoruz.
app.use(express.static('public'));

// PostgreSQL bağlantısı
const pool = new Pool({
  connectionString: DATABASE_URL,
});

// Uygulama tablosunun oluşturulması (eğer yoksa)
pool.query(`
  CREATE TABLE IF NOT EXISTS apps (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    image TEXT,
    healthpath TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`)
  .then(() => console.log("Table 'apps' hazır."))
  .catch(err => console.error("Tablo oluşturma hatası:", err.message));

// Kimlik doğrulama middleware’i
function isAuthenticated(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen giriş yapın.' });
  }
  res.redirect('/login');
}

// CRUD API Endpoint’leri

app.get('/api/apps', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apps ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/apps', isAuthenticated, async (req, res) => {
  try {
    // Gelen JSON içerisinde healthpath olarak alıyoruz.
    const { title, url, image, healthpath } = req.body;
    const result = await pool.query(
      'INSERT INTO apps (title, url, image, healthpath) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, url, image, healthpath]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/apps/:id', isAuthenticated, async (req, res) => {
  try {
    const id = req.params.id;
    const { title, url, image, healthpath } = req.body;
    const result = await pool.query(
      'UPDATE apps SET title = $1, url = $2, image = $3, healthpath = $4 WHERE id = $5 RETURNING *',
      [title, url, image, healthpath, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Uygulama bulunamadı.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/apps/:id', isAuthenticated, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await pool.query('DELETE FROM apps WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Uygulama bulunamadı.' });
    }
    res.json({ message: 'Uygulama silindi.', removedApp: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy Health Check Endpoint – CORS sorunlarını aşmak için
app.get('/proxy-health', async (req, res) => {
  const healthUrl = req.query.url;
  if (!healthUrl) {
    return res.status(400).json({ error: 'Health URL belirtilmedi.' });
  }
  try {
    const proxyRes = await fetch(healthUrl);
    res.sendStatus(proxyRes.status);
  } catch (error) {
    res.status(500).json({ error: 'Health check başarısız.', details: error.message });
  }
});

// Giriş İşlemleri

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.user = username;
    res.json({ message: 'Giriş başarılı!' });
  } else {
    res.status(401).json({ error: 'Geçersiz kimlik bilgileri.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Çıkış yapılamadı.' });
    }
    res.json({ message: 'Başarıyla çıkış yapıldı.' });
  });
});

// Admin paneli
app.get('/admin', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// Yeni: /api/config endpoint'i şirket adını ve ikon URL'sini döndürür.
app.get('/api/config', (req, res) => {
  res.json({
    companyName: process.env.COMPANY_NAME || 'Default Company',
    companyIcon: process.env.COMPANY_ICON_URL || 'https://via.placeholder.com/40'
  });
});

app.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
