const express = require('express');
const app = express();

app.use(express.json());

// Allow all origins
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

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

app.get('/', (req, res) => res.send('ORS Claude Proxy OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Proxy running on port ' + PORT));
