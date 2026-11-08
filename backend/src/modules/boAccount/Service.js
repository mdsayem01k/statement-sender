const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DeliveryLedger = require('../../services/DeliveryLedger');
const { Sender, rejection } = require('./Sender');
const templates = require('./templates.json');

const first = value =>
  String(value || '').split(',')[0].trim();

const escape = value =>
  String(value).replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character])
  );

function render(source, data) {
  return source.replace(
    /\{\{(\w+)\}\}/g,
    (_, name) => {
      if (
        data[name] == null ||
        String(data[name]).trim() === ''
      ) {
        throw rejection(
          `Missing template value: ${name}`
        );
      }

      return String(data[name]);
    }
  );
}

function time(value) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
    .format(new Date(value))
    .replace(
      /\b(am|pm)\b/g,
      value => value.toUpperCase()
    );
}

class Service {
  constructor(ctx, repository, settings) {
    this.ctx = ctx;
    this.repository = repository;
    this.settings = settings;

    this.sender = new Sender(
      ctx.messageCenter,
      settings
    );

    this.ledger = new DeliveryLedger({
      module: 'BO_ACCOUNT',
      poolName: 'poolPromise'
    });
  }

  async sync() {
    await this.repository.ensureTables();

    const source = await this.repository.source();

    if (!source.length) {
      return {
        fetched: 0,
        stored: 0
      };
    }

    const seen = new Set();

    for (const row of source) {
      const investorCode = String(
        row.InvestorCode
      ).trim().toUpperCase();

      if (seen.has(investorCode)) {
        throw new Error(
          `Duplicate investor code: ${investorCode}`
        );
      }

      seen.add(investorCode);
    }

    const rows = await this.repository.related(source);

    let stored = 0;

    for (const row of rows) {
      stored += await this.repository.insert(row);
    }

    return {
      fetched: rows.length,
      stored
    };
  }

  pdfPath(item) {
    const code = item.InvestorCode;

    if (!/^[A-Za-z0-9_-]{1,50}$/.test(code)) {
      throw rejection(
        'Invalid investor filename'
      );
    }

    return path.join(
      this.settings.pdfDir,
      `${code}.pdf`
    );
  }

  async pdfExists(item) {
    try {
      const file = await fs.promises.stat(
        this.pdfPath(item)
      );

      return file.isFile();
    } catch (error) {
      if (
        ['ENOENT', 'ENOTDIR'].includes(error.code)
      ) {
        return false;
      }

      throw error;
    }
  }

  eligible(item) {
    const approvedDate = new Date(
      item.ApprovedDate
    );

    const cutoff = new Date(
      `${this.settings.since}Z`
    );

    if (
      Number.isNaN(approvedDate.getTime()) ||
      approvedDate < cutoff
    ) {
      throw rejection(
        'Account is before cutoff'
      );
    }

    if (
      !item.data.BOID ||
      !/^\d{13}$/.test(item.data.VANumber)
    ) {
      throw rejection(
        'BOID or 13-digit VA is missing/invalid'
      );
    }
  }

  async preview(item) {
    this.eligible(item);

    const saved = item.data;

    const defaultRm = {
      name: String(
        process.env.BO_ACCOUNT_DEFAULT_RM_NAME ||
        'Client Services Team'
      ).trim(),

      mobile: first(
        process.env.BO_ACCOUNT_DEFAULT_RM_MOBILE
      ),

      email: first(
        process.env.BO_ACCOUNT_DEFAULT_RM_EMAIL
      )
    };

    const d = {
      ...saved,

      rm: {
        name:
          String(saved.rm?.name || '').trim() ||
          defaultRm.name,

        mobile:
          first(saved.rm?.mobile) ||
          defaultRm.mobile,

        email:
          first(saved.rm?.email) ||
          defaultRm.email
      }
    };

    const base = String(
      this.ctx.env.app.statementsBaseUrl
    ).replace(/\/+$/, '');

    const data = {
      investorName: d.InvestorName,
      investorCode: d.InvestorCode,
      boid: d.BOID,
      investorMobile: d.Mobile,
      investorEmail: d.Email,
      vaNumber: d.VANumber,

      ackUrl:
        `${base}/api/BOACK?BOID=${item.URLCode}`,

      rmName: d.rm.name,
      rmMobile: d.rm.mobile,
      rmEmail: d.rm.email,

      registrationNo: d.RegistrationNo,
      agentRef: d.AgentRefCode,

      dateTime: time(
        item.DispatchAt || new Date()
      )
    };

    const hash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify([
          d,
          base,
          templates,
          this.settings
        ])
      )
      .digest('hex');

    const pdfReady = await this.pdfExists(item);
    const plans = [];

    const add = (
      role,
      via,
      person,
      problem = null
    ) => {
      const entry = {
        role,
        via,

        recipient: {
          ...person,
          role
        },

        whatsappOnly: role !== 'INVESTOR'
      };

      try {
        if (problem) {
          throw rejection(problem);
        }

        const template = templates[role];

        entry.text = render(
          template.text,
          data
        );

        if (via === 'EMAIL') {
          entry.subject = render(
            template.subject,
            data
          );

          if (template.emailExtra) {
            entry.text +=
              `\n\n${render(template.emailExtra, data)}`;
          }

          entry.html =
            `<div style="font-family:Arial,sans-serif">` +
            `<h2 style="background:#c8102e;color:white;padding:18px">` +
            `Cty Brokerage Limited` +
            `</h2>` +
            `<div style="border:1px solid #c8102e;padding:20px">` +
            escape(entry.text).replace(/\n/g, '<br>') +
            `</div>` +
            `</div>`;
        }

        const destination =
          via === 'EMAIL'
            ? person?.email
            : person?.mobile;

        if (!destination) {
          throw rejection(
            `Missing ${role} ${via} contact`
          );
        }
      } catch (error) {
        entry.error = error.message;
      }

      plans.push(entry);
    };

    let applicantProblem = null;

    if (!pdfReady) {
      applicantProblem =
        'Acknowledgement PDF is missing';
    } else if (
      !d.rm.name ||
      !d.rm.mobile ||
      !d.rm.email
    ) {
      applicantProblem =
        'RM contact is incomplete; configure the default RM name, mobile and email';
    }

    if (
      this.settings.whatsappEnabled ||
      this.settings.smsEnabled
    ) {
      add(
        'INVESTOR',
        'MOBILE',
        {
          name: d.InvestorName,
          mobile: d.Mobile
        },
        applicantProblem
      );
    }

    if (this.settings.emailEnabled) {
      add(
        'INVESTOR',
        'EMAIL',
        {
          name: d.InvestorName,
          email: d.Email
        },
        applicantProblem
      );
    }

    if (this.settings.rmEnabled) {
      add(
        'RM',
        'MOBILE',
        d.rm,
        !d.rm.mobile
          ? 'RM mobile is missing; configure BO_ACCOUNT_DEFAULT_RM_MOBILE'
          : null
      );
    }

    if (d.referral) {
      let referralProblem = null;

      if (!d.agent) {
        referralProblem =
          'Agent reference was not found; Agent and City Bank are held';
      } else if (!d.RegistrationNo) {
        referralProblem =
          'Registration number is missing';
      }

      const recipients = [
        [
          'AGENT',
          d.agent,
          this.settings.agentEnabled
        ],
        [
          'CITYBANK',
          d.bank,
          this.settings.bankEnabled
        ]
      ];

      for (const [role, person, enabled] of recipients) {
        if (!enabled) {
          continue;
        }

        add(
          role,
          'MOBILE',
          person,
          referralProblem
        );

        if (this.settings.emailEnabled) {
          add(
            role,
            'EMAIL',
            person,
            referralProblem
          );
        }
      }
    }

    return {
      id: item.NotificationID,
      hash,
      pdfReady,
      plans,
      ackUrl: data.ackUrl
    };
  }

  async send(id, expectedHash) {
    let item = await this.repository.find(id);

    if (!item) {
      throw rejection(
        'Account not found',
        404
      );
    }

    let preview = await this.preview(item);

    if (expectedHash !== preview.hash) {
      throw rejection(
        'Account/settings changed; preview again',
        409
      );
    }

    item = await this.repository.dispatch(id);
    preview = await this.preview(item);

    if (preview.hash !== expectedHash) {
      throw rejection(
        'Account changed during dispatch; preview again',
        409
      );
    }

    const legacy =
      await this.repository.legacyDeliveries(item);

    const results = [];

    for (const plan of preview.plans) {
      if (plan.error) {
        results.push({
          role: plan.role,
          via: plan.via,
          state: 'NEEDS_ATTENTION',
          error: plan.error
        });

        continue;
      }

      const previous = legacy.find(
        entry =>
          entry.RecipientRole === plan.role &&
          entry.Via === plan.via
      );

      if (previous) {
        results.push({
          role: plan.role,
          via: plan.via,
          state: `LEGACY_${previous.State}`,
          skipped: true
        });

        continue;
      }

      const claim = await this.ledger.claim(
        id,
        plan.role,
        plan.via
      );

      if (!claim.allowed) {
        results.push({
          role: plan.role,
          via: plan.via,
          state: claim.state,
          skipped: true
        });

        continue;
      }

      let result;

      try {
        result = await this.sender.send(plan);
      } catch (error) {
        const state = error.definitelyNotSent
          ? 'FAILED'
          : 'UNKNOWN';

        await this.ledger.record(
          claim,
          state,
          null,
          error.message
        );

        await this.audit(
          item,
          plan,
          state,
          error.message
        );

        results.push({
          role: plan.role,
          via: plan.via,
          state,
          error: error.message
        });

        continue;
      }

      try {
        await this.ledger.record(
          claim,
          'ACCEPTED',
          result.channel
        );

        await this.ledger.record(
          claim,
          'SENT',
          result.channel
        );

        results.push({
          role: plan.role,
          via: plan.via,
          state: 'SENT',
          channel: result.channel
        });
      } catch (error) {
        results.push({
          role: plan.role,
          via: plan.via,
          state: 'RECONCILIATION_REQUIRED',
          channel: result.channel,
          error: error.message
        });
      }

      await this.audit(
        item,
        plan,
        `${result.channel}_SENT`
      );
    }

    return results;
  }

  async audit(
    item,
    plan,
    status,
    errorMessage = null
  ) {
    try {
      await this.ctx.audit.save({
        encryptoCode: item.URLCode,
        resolvedCode: item.InvestorCode,
        recipientRole: plan.role,
        status: `BO_ACCOUNT_${status}`,
        statusCode: errorMessage ? 502 : 200,
        errorMessage
      });
    } catch (error) {
      console.error(
        '[BO ACCOUNT AUDIT]',
        error.message
      );
    }
  }
}

module.exports = {
  Service,
  render,
  time
};