const { OneSecMailbox } = require('onesec-api');
const request = require('request');
const { sleep } = require('./utils');

const defaultHeaders = {
  origin: 'https://www.reddit.com'
};

module.exports = class AccountCreator {
  constructor(httpClient) {
    this.jar = request.jar();
    this.httpClient = httpClient.defaults({ jar: this.jar });
  }

  async randomName() {
    const {body} = await this.request({
      url: 'https://www.reddit.com/api/v1/generate_username.json',
      json: true,
    });
    return body?.usernames?.[0];
  }
  
  async create(recaptchaToken) {
    console.log('Creating new account...');
    if (!recaptchaToken) return { error: 'recaptcha_token_not_found' };

    let {error, response, body} = await this.request({
      url: 'https://www.reddit.com/',
    });
    await sleep(1000);
    
    ({error, response, body} = await this.request({
      url: 'https://www.reddit.com/account/sso/one_tap',
    }));
    const csrfToken = body?.match(/name=\"csrf_token\"\ value=\"(\w+)\"\>/)?.[1];
    if (!csrfToken) return { error: 'csrf_token_not_found' };
    await sleep(3000);

    const domains = ['wwjmp.com', 'vddaz.com', 'yoggm.com', 'xojxe.com', 'esiix.com'];
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const username = await this.randomName();
    const email = username + '@' + domain;
    const password = username.substring(1, username.length - 1) + '#@';
    ({error, response, body} = await this.request({
      url: 'https://www.reddit.com/register',
      method: 'POST',
      form: {
        'csrf_token': csrfToken,
        'g-recaptcha-response': recaptchaToken,
        'password': password,
        'dest': 'https://www.reddit.com',
        'email_permission': 'false',
        'lang': 'en',
        'username': username,
        'email': email,
      },
      json: true,
    }));
    if (body?.dest !== 'https://www.reddit.com') {
      if (body?.reason === 'RATELIMIT') {
        return { error: 'rate_limit' };
      } else {
        console.error('Account Creator Unknown Error', body);
        return { error: 'unknown' };
      }
    }
    ({error, response, body} = await this.request({
      url: 'https://www.reddit.com/',
    }));
    const cookies = this.jar.getCookies('https://www.reddit.com');
    const session = cookies.find(x => x.key === 'session')?.value;
    const redditSession = cookies.find(x => x.key === 'reddit_session')?.value;
    if (!session || !redditSession) return { error: 'cookies_not_found' };

    console.log('Waiting 10 secs to see reddit mail');
    await sleep(10000);

    const oneSec = new OneSecMailbox(username, domain);

    let verified = false;
    for (let i = 0; i < 5; i++) {
      const mailBox = await oneSec.getMail();
      const redditMail = mailBox.find(x => x.getSubject().includes('Reddit email'));
      if (!redditMail) {
        console.log('Waiting 2 secs to see reddit mail');
        await sleep(2000);
        continue;
      }
      const html = redditMail.getHtmlBody();
      const verificationUrl = html.match(/\"(https\:\/\/www\.reddit\.com\/verification[^\"]+)\"/)?.[1];
      if (!verificationUrl) continue;

      await this.request({
        url: verificationUrl,
      });
      verified = true;
      break;
    }

    if (!verified) return { error: 'verification_failed' };

    return {email, username, password, session, redditSession};
  }

  request(opts) {
    return new Promise(resolve => this.httpClient({headers: defaultHeaders, ...opts}, (error, response, body) => resolve({error, response, body})));
  }
}
