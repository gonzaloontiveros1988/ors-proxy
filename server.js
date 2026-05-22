const express = require('express');
const app = express();

app.use(express.json());

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Claude API proxy
app.post('/claude', async function(req, res) {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(400).json({error: 'Missing API key'});
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// Yahoo Finance proxy
app.get('/yahoo', async function(req, res) {
  try {
    const sym = req.query.sym;
    const range = req.query.range || '2y';
    if (!sym) return res.status(400).json({error: 'Missing sym'});
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'+sym+'?interval=1d&range='+range;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    const data = await response.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.get('/', (req, res) => res.send('ORS Proxy OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on ' + PORT));
