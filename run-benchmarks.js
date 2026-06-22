const autocannon = require('autocannon');
const http = require('http');
const fs = require('fs');
const path = require('path');

function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function generateRandomIp() {
  return `${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;
}

async function runScenarioA() {
  console.log('Running Scenario A - Redirect (cache warm)...');
  // First request manually to ensure cached
  await makeRequest({ host: 'localhost', port: 80, path: '/1', method: 'GET' });

  const result = await autocannon({
    url: 'http://localhost/1',
    connections: 50,
    duration: 20,
    requests: [
      {
        method: 'GET',
        path: '/1',
        setupRequest: (req) => {
          req.headers = req.headers || {};
          req.headers['x-forwarded-for'] = generateRandomIp();
          return req;
        }
      }
    ]
  });
  return result;
}

async function runScenarioB() {
  console.log('Running Scenario B - Redirect (cold/no cache)...');
  // Flush cache first
  await makeRequest({ host: 'localhost', port: 80, path: '/cache/1', method: 'DELETE' });

  const result = await autocannon({
    url: 'http://localhost/1',
    connections: 1,
    amount: 1, // Single request to measure cold latency
    requests: [
      {
        method: 'GET',
        path: '/1',
        setupRequest: (req) => {
          req.headers = req.headers || {};
          req.headers['x-forwarded-for'] = generateRandomIp();
          return req;
        }
      }
    ]
  });
  return result;
}

async function runScenarioC() {
  console.log('Running Scenario C - Shorten endpoint (write path)...');
  const result = await autocannon({
    url: 'http://localhost/shorten',
    connections: 50,
    duration: 20,
    requests: [
      {
        method: 'POST',
        path: '/shorten',
        headers: {
          'Content-Type': 'application/json'
        },
        setupRequest: (req) => {
          req.headers = req.headers || {};
          req.headers['x-forwarded-for'] = generateRandomIp();
          req.body = JSON.stringify({ longUrl: `https://benchmark.test/${Math.random().toString(36).substring(2, 15)}` });
          return req;
        }
      }
    ]
  });
  return result;
}

async function runScenarioD() {
  console.log('Running Scenario D - Rate limit behavior...');
  const result = await autocannon({
    url: 'http://localhost/1',
    connections: 200,
    duration: 10,
    requests: [
      {
        method: 'GET',
        path: '/1' // No dynamic IP header, so they all share local IP and trigger 429
      }
    ]
  });
  return result;
}

async function main() {
  try {
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir);
    }
    const logFile = path.join(resultsDir, 'benchmark-results.txt');
    fs.writeFileSync(logFile, `TinyScale Load Testing Benchmarks - ${new Date().toISOString()}\n\n`);

    const resultA = await runScenarioA();
    const resultB = await runScenarioB();
    const resultC = await runScenarioC();
    const resultD = await runScenarioD();

    const formatResult = (name, res) => {
      let output = `==================================================\n`;
      output += `${name}\n`;
      output += `==================================================\n`;
      output += `Duration: ${res.duration}s\n`;
      output += `Connections: ${res.connections}\n`;
      output += `Requests/sec: ${res.requests.average}\n`;
      output += `Total Requests: ${res.requests.total}\n`;
      output += `Throughput (Mb/s): ${(res.throughput.average / 1024 / 1024 * 8).toFixed(2)}\n`;
      output += `Latency Average (ms): ${res.latency.average}\n`;
      output += `Latency p50 (ms): ${res.latency.p50}\n`;
      output += `Latency p90 (ms): ${res.latency.p90}\n`;
      output += `Latency p97.5 (ms): ${res.latency.p97_5}\n`;
      output += `Latency p99 (ms): ${res.latency.p99}\n`;
      output += `HTTP 2xx: ${res['2xx'] || 0}\n`;
      output += `HTTP 3xx: ${res['3xx'] || 0}\n`;
      output += `HTTP 4xx: ${res['4xx'] || 0}\n`;
      output += `HTTP 5xx: ${res['5xx'] || 0}\n`;
      output += `Non-2xx/3xx/4xx/5xx Errors: ${res.errors || 0}\n\n`;
      return output;
    };

    const outA = formatResult('Scenario A: Redirect (cache warm) - Concurrency 50 for 20s', resultA);
    const outB = formatResult('Scenario B: Redirect (cold/no cache) - 1 Request', resultB);
    const outC = formatResult('Scenario C: Shorten Endpoint (write path) - Concurrency 50 for 20s', resultC);
    const outD = formatResult('Scenario D: Rate Limit Behavior - Concurrency 200 for 10s', resultD);

    fs.appendFileSync(logFile, outA);
    fs.appendFileSync(logFile, outB);
    fs.appendFileSync(logFile, outC);
    fs.appendFileSync(logFile, outD);

    console.log('All benchmarks run successfully and written to results/benchmark-results.txt');
    
    // Print summary to console
    console.log(outA);
    console.log(outB);
    console.log(outC);
    console.log(outD);

  } catch (err) {
    console.error('Error running benchmarks:', err);
    process.exit(1);
  }
}

main();
