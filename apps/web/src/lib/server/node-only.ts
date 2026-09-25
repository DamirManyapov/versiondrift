// Stands in for Node-only packages in the Cloudflare build (vite.config.ts): the public site never sends mail or
// schedules jobs, and Workers can't load these (child_process, net, tls, …).
const unavailable = (what: string) => () => {
  throw new Error(`${what} is not available in this build (self-hosted only)`);
};

/** nodemailer */
export const createTransport = unavailable('e-mail');

/** croner */
export class Cron {
  constructor() {
    unavailable('scheduling')();
  }
}
