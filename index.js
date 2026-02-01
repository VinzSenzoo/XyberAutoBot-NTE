import axios from 'axios';
import cfonts from 'cfonts';
import gradient from 'gradient-string';
import chalk from 'chalk';
import fs from 'fs/promises';
import readline from 'readline';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import ora from 'ora';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const logger = {
  info: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || 'ℹ️  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.green('INFO');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  warn: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '⚠️ ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.yellow('WARN');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  error: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '❌ ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.red('ERROR');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  debug: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '🔍  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.blue('DEBUG');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  }
};

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function countdown(seconds, message) {
  return new Promise((resolve) => {
    let remaining = seconds;
    process.stdout.write(`${message} ${remaining}s remaining...`);
    const interval = setInterval(() => {
      remaining--;
      process.stdout.clearLine();
      process.stdout.cursorTo(0);
      process.stdout.write(`${message} ${remaining}s remaining...`);
      if (remaining <= 0) {
        clearInterval(interval);
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        resolve();
      }
    }, 1000);
  });
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

function centerText(text, width) {
  const cleanText = stripAnsi(text);
  const textLength = cleanText.length;
  const totalPadding = Math.max(0, width - textLength);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
}

function printHeader(title) {
  const width = 80;
  console.log(gradient.morning(`┬${'─'.repeat(width - 2)}┬`));
  console.log(gradient.morning(`│ ${title.padEnd(width - 4)} │`));
  console.log(gradient.morning(`┴${'─'.repeat(width - 2)}┴`));
}

function printInfo(label, value, context) {
  logger.info(`${label.padEnd(15)}: ${chalk.cyan(value)}`, { emoji: '📍 ', context });
}

function printProfileInfo(address, totalXp, context) {
  printHeader(`Profile Info ${context}`);
  printInfo('Wallet Address', maskAddress(address), context);
  printInfo('Total XP', totalXp, context);
  console.log('\n');
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/102.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getAxiosConfig(proxy, cookies = '') {
  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    'origin': 'https://app.xyber.inc',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
    'referer': 'https://app.xyber.inc/',
    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': getRandomUserAgent()
  };
  if (cookies) {
    headers['cookie'] = cookies;
  }
  const config = {
    headers,
    timeout: 60000
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
    config.proxy = false;
  }
  return config;
}

function newAgent(proxy) {
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    logger.warn(`Unsupported proxy: ${proxy}`);
    return null;
  }
}

async function requestWithRetry(method, url, payload = null, config = {}, retries = 3, backoff = 2000, context) {
  for (let i = 0; i < retries; i++) {
    try {
      let response;
      if (method.toLowerCase() === 'get') {
        response = await axios.get(url, config);
      } else if (method.toLowerCase() === 'post') {
        response = await axios.post(url, payload, config);
      } else {
        throw new Error(`Method ${method} not supported`);
      }
      return response;
    } catch (error) {
      let errorMsg = error.message;
      if (error.response) {
        errorMsg += ` | Status: ${error.response.status} | Body: ${JSON.stringify(error.response.data || 'No body')}`;
      }
      logger.error(`Request failed: ${errorMsg}`, { context });

      if (error.response && error.response.status === 429) {
        backoff = Math.max(backoff, 5000);
      }

      if (error.response && (error.response.status >= 500 || error.response.status === 429) && i < retries - 1) {
        logger.warn(`Retrying ${method.toUpperCase()} ${url} (${i + 1}/${retries}) due to server error or rate limit`, { emoji: '🔄', context });
        await delay(backoff / 1000);
        backoff *= 2;
        continue;
      }

      throw error;
    }
  }
}

async function readAccounts() {
  try {
    const data = await fs.readFile('pk.txt', 'utf-8');
    const privateKeys = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const accounts = privateKeys.map(pk => ({ privateKey: pk }));
    if (accounts.length === 0) {
      throw new Error('No private keys found in pk.txt');
    }
    logger.info(`Loaded ${accounts.length} account${accounts.length === 1 ? '' : 's'}`, { emoji: '🔑 ' });
    return accounts;
  } catch (error) {
    logger.error(`Failed to read pk.txt: ${error.message}`, { emoji: '❌ ' });
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    const proxies = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (proxies.length === 0) {
      logger.warn('No proxies found. Proceeding without proxy.', { emoji: '⚠️ ' });
    } else {
      logger.info(`Loaded ${proxies.length} prox${proxies.length === 1 ? 'y' : 'ies'}`, { emoji: '🌐 ' });
    }
    return proxies;
  } catch (error) {
    logger.warn('proxy.txt not found.', { emoji: '⚠️ ' });
    return [];
  }
}

function maskAddress(address) {
  return address ? `${address.slice(0, 6)}${'*'.repeat(6)}${address.slice(-6)}` : 'N/A';
}

function deriveWalletAddress(privateKey) {
  try {
    const secretKey = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(secretKey);
    return keypair.publicKey.toBase58();
  } catch (error) {
    logger.error(`Failed to derive address: ${error.message}`);
    return null;
  }
}

async function performLogin(proxy, context, address, privateKey) {
  const challengeUrl = `https://ai-auth-service.xyber.inc/api/auth/challenge?address=${address}&network=solana`;
  const config = getAxiosConfig(proxy);
  const spinner = ora({ text: 'Fetching login challenge...', spinner: 'dots' }).start();
  try {
    const challengeResponse = await requestWithRetry('get', challengeUrl, null, config, 3, 2000, context);
    if (challengeResponse.data.success) {
      spinner.succeed(chalk.bold.greenBright(' Challenge fetched successfully'));
      const challenge = challengeResponse.data.data.challenge;
      
      const secretKey = bs58.decode(privateKey);
      const keypair = Keypair.fromSecretKey(secretKey);
      const message = new TextEncoder().encode(challenge);
      const signatureBytes = nacl.sign.detached(message, keypair.secretKey);
      const signature = bs58.encode(signatureBytes);
      
      const verifyUrl = 'https://ai-auth-service.xyber.inc/api/auth/verify';
      const verifyPayload = { address, signature };
      const verifyResponse = await requestWithRetry('post', verifyUrl, verifyPayload, config, 3, 2000, context);
      
      if (verifyResponse.data.success) {
        const { access_token, refresh_token } = verifyResponse.data.data;
        spinner.succeed(chalk.bold.greenBright(' Login Successfully'));
        return { access_token, refresh_token };
      } else {
        throw new Error(' Login verification failed');
      }
    } else {
      throw new Error(' Failed to get challenge');
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Login failed: ${error.message}`));
    return null;
  }
}

async function performDailySpin(proxy, context, cookies) {
  const url = 'https://hub.xyber.inc/api/spinner';
  const config = getAxiosConfig(proxy, cookies);
  config.validateStatus = (status) => status >= 200 && status < 500;
  const spinnerOra = ora({ text: 'Performing daily spin...', spinner: 'dots' }).start();
  try {
    const response = await requestWithRetry('post', url, {}, config, 3, 2000, context);
    if (response.status === 200 && response.data.ok) {
      const xpReward = response.data.data.xpReward.replace('p', '');
      spinnerOra.succeed(chalk.bold.greenBright(` Spin successful! Gained ${xpReward} XP`));
      return { success: true };
    } else if (response.status === 400 && response.data.error === 'user have already spun today') {
      spinnerOra.warn(chalk.bold.yellowBright(' Already Spin today'));
      return { success: false, message: 'Already spun' };
    } else {
      throw new Error(`Unexpected response: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    spinnerOra.fail(chalk.bold.redBright(`Spin failed: ${error.message}`));
    return null;
  }
}

async function getUserProfile(proxy, context, cookies, address) {
  const url = 'https://hub.xyber.inc/api/user/profile';
  const config = getAxiosConfig(proxy, cookies);
  const spinner = ora({ text: 'Fetching user profile...', spinner: 'dots' }).start();
  try {
    const response = await requestWithRetry('get', url, null, config, 3, 2000, context);
    if (response.data.ok) {
      const totalXp = response.data.data.xp;
      spinner.succeed(chalk.bold.greenBright(' Profile fetched successfully'));
      return { totalXp };
    } else {
      throw new Error(' Failed to fetch profile');
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(`Profile fetch failed: ${error.message}`));
    return null;
  }
}

async function getPublicIP(proxy, context) {
  try {
    const config = getAxiosConfig(proxy);
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, config, 3, 2000, context);
    return response.data.ip || 'Unknown';
  } catch (error) {
    logger.error(`Failed to get IP: ${error.message}`, { emoji: '❌ ', context });
    return 'Error retrieving IP';
  }
}

async function processAccount(account, index, total, proxy) {
  const context = `Account ${index + 1}/${total}`;
  logger.info(chalk.bold.magentaBright(`Starting account processing`), { emoji: '🚀 ', context });

  const { privateKey } = account;
  const address = deriveWalletAddress(privateKey);
  if (!address) {
    logger.error('Invalid private key', { emoji: '❌ ', context });
    return;
  }

  printHeader(`Account Info ${context}`);
  printInfo('Wallet Address', maskAddress(address), context);
  const ip = await getPublicIP(proxy, context);
  printInfo('IP', ip, context);
  console.log('\n');

  try {
    logger.info('Starting Login Process...', { emoji: '🔑 ', context });
    const loginResult = await performLogin(proxy, context, address, privateKey);
    if (!loginResult) {
      throw new Error('Login failed');
    }
    const { access_token, refresh_token } = loginResult;
    const cookies = `access_token=${access_token}; refresh_token=${refresh_token}`;
    await delay(2);

    console.log('\n');
    logger.info('Starting Daily Spin Process...', { emoji: '🎰 ', context });
    console.log('\n');
    await delay(5);

    const spinResult = await performDailySpin(proxy, context, cookies);
    if (spinResult && spinResult.success) {
      await delay(5);
    }

    console.log('\n');
    await delay(5);

    const profileResult = await getUserProfile(proxy, context, cookies, address);
    if (profileResult) {
      const { totalXp } = profileResult;
      printProfileInfo(address, totalXp, context);
    }

    logger.info(chalk.bold.greenBright(`Completed account processing`), { emoji: '🎉 ', context });
    console.log(chalk.cyanBright('________________________________________________________________________________'));
  } catch (error) {
    logger.error(`Error processing account: ${error.message}`, { emoji: '❌ ', context });
  }
}

let globalUseProxy = false;
let globalProxies = [];

async function initializeConfig() {
  const useProxyAns = await askQuestion(chalk.cyanBright('🔌 Do You Want to Use Proxy? (y/n): '));
  if (useProxyAns.trim().toLowerCase() === 'y') {
    globalUseProxy = true;
    globalProxies = await readProxies();
    if (globalProxies.length === 0) {
      globalUseProxy = false;
      logger.warn('No proxies available, proceeding without proxy.', { emoji: '⚠️ ' });
    }
  } else {
    logger.info('Proceeding without proxy.', { emoji: 'ℹ️ ' });
  }
}

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function runCycle() {
  const accounts = await readAccounts();
  if (accounts.length === 0) {
    logger.error('No accounts found in pk.txt. Exiting cycle.', { emoji: '❌ ' });
    return;
  }

  for (let i = 0; i < accounts.length; i++) {
    const proxy = globalUseProxy ? globalProxies[i % globalProxies.length] : null;
    try {
      await processAccount(accounts[i], i, accounts.length, proxy);
    } catch (error) {
      logger.error(`Error processing account: ${error.message}`, { emoji: '❌ ', context: `Account ${i + 1}/${accounts.length}` });
    }
    if (i < accounts.length - 1) {
      console.log('\n\n');
    }
    await delay(Math.floor(Math.random() * 6) + 10);
  }
}

async function run() {
  const terminalWidth = process.stdout.columns || 80;
  cfonts.say('NT EXHAUST', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true
  });
  console.log(gradient.retro(centerText('=== Telegram Channel 🚀 : NT Exhaust (@NTExhaust) ===', terminalWidth)));
  console.log(gradient.retro(centerText('✪ BOT XYBER AUTO DAILY SPIN ✪', terminalWidth)));
  console.log('\n');
  await initializeConfig();

  while (true) {
    await runCycle();
    console.log();
    logger.info(chalk.bold.yellowBright('Cycle completed. Waiting 24 hours...'), { emoji: '🔄 ' });
    await delay(86400);
  }
}

run().catch(error => logger.error(`Fatal error: ${error.message}`, { emoji: '❌' }));
