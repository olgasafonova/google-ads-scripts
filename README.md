# Google Ads Scripts

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Made for Google Ads](https://img.shields.io/badge/Made%20for-Google%20Ads-4285F4?logo=google-ads&logoColor=white)](https://ads.google.com)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES5-F7DF1E?logo=javascript&logoColor=black)](https://developers.google.com/google-ads/scripts)

Free, open-source automation scripts for Google Ads. No coding experience required to use them.

**What these scripts do:** They run inside your Google Ads account on a schedule you set, automatically monitoring your campaigns and alerting you when something needs attention. Think of them as a virtual assistant that watches your account 24/7.

**Why use them:** Stop manually checking for budget overspend, broken landing pages, or Quality Score drops. These scripts do it for you and send alerts to your email or Slack.

## Scripts

### Budget Pacing
Know instantly when campaigns are spending too fast or too slow.

| Category | Script | Description |
|----------|--------|-------------|
| Budget Pacing | [daily-budget-monitor.js](scripts/budget-pacing/daily-budget-monitor.js) | Get alerts when a campaign spends more than 110% of its daily budget, or less than 50% by midday |
| | [monthly-pacing-report.js](scripts/budget-pacing/monthly-pacing-report.js) | Weekly email showing if you're on track to hit monthly spend targets |

### Quality Score Tracking
Track Quality Score over time. Google only shows current QS; these scripts build a historical record.

| Category | Script | Description |
|----------|--------|-------------|
| Quality Score | [qs-tracker.js](scripts/quality-score/qs-tracker.js) | Daily snapshot of QS for all keywords, saved to Google Sheets |
| | [qs-alert.js](scripts/quality-score/qs-alert.js) | Get notified when high-value keywords drop in Quality Score |

### Search Query Mining
Find wasted spend hiding in your search terms.

| Category | Script | Description |
|----------|--------|-------------|
| Search Queries | [n-gram-analyzer.js](scripts/search-query-mining/n-gram-analyzer.js) | Analyze word patterns in search queries to find themes |
| | [negative-keyword-miner.js](scripts/search-query-mining/negative-keyword-miner.js) | Automatically suggest negative keywords based on poor-performing queries |

### Placement Exclusions
Stop your Display and YouTube ads from showing on junk websites and apps.

| Category | Script | Description |
|----------|--------|-------------|
| Placements | [low-quality-detector.js](scripts/placement-exclusions/low-quality-detector.js) | Flag placements with suspiciously low CTR or high bounce rates |
| | [placement-exclusion-list.js](scripts/placement-exclusions/placement-exclusion-list.js) | Automatically exclude known low-quality sites and apps |

### Performance Max Analysis
See inside the PMax "black box" as much as Google allows.

| Category | Script | Description |
|----------|--------|-------------|
| PMax | [brand-overlap-detector.js](scripts/pmax-analysis/brand-overlap-detector.js) | Estimate how much PMax is cannibalizing your branded Search campaigns |
| | [asset-group-performance.js](scripts/pmax-analysis/asset-group-performance.js) | Compare performance across asset groups |

### Landing Page Monitoring
Catch broken pages before they waste your ad spend.

| Category | Script | Description |
|----------|--------|-------------|
| Landing Pages | [status-checker.js](scripts/landing-page/status-checker.js) | Check for 404 errors, slow load times, and SSL issues |

## Quick Start

No coding required. You just copy, paste, and configure a few settings.

1. Open your Google Ads account
2. Go to **Tools & Settings** → **Bulk Actions** → **Scripts**
3. Click **+** → **New script**
4. Delete the placeholder code and paste in the script you want
5. Update the `CONFIG` section at the top (see below)
6. Click **Preview** to test without making changes
7. Click **Authorize** when prompted (scripts need permission to access your account)
8. Once it works, click **Schedule** to run automatically

## Configuration

Each script has a `CONFIG` section at the top where you set your preferences. At minimum, you need to:

1. **Create a Google Sheet** to store the output (just create a blank sheet)
2. **Copy the sheet URL** and paste it into the script
3. **Add your email** to receive alerts

Here's what the CONFIG section looks like:

```
var CONFIG = {
  SPREADSHEET_URL: 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit',
  EMAIL_RECIPIENTS: 'you@example.com',
  SLACK_WEBHOOK_URL: '', // Optional
};
```

Replace `YOUR_SHEET_ID` with your actual sheet URL. That's it.

## Notifications

**Email:** Built-in. Just add your email address to `EMAIL_RECIPIENTS` in the CONFIG.

**Slack:** Optional. If you want alerts in Slack, [create a webhook URL](https://api.slack.com/messaging/webhooks) and add it to `SLACK_WEBHOOK_URL`.

**Google Sheets:** All scripts automatically log data to your Google Sheet, even if you don't set up email or Slack.

## Requirements

- Google Ads account (test account works for development)
- Google Sheets (for output)

No coding skills needed to use the scripts as-is. Basic JavaScript helps if you want to customize them.

## Limitations

Google Ads Scripts have built-in limits set by Google:

- **30-minute runtime** — Scripts stop after 30 minutes. Fine for most accounts, but very large accounts may need to split scripts.
- **50,000 items per query** — If you have more than 50,000 keywords, you'll need to filter by campaign.
- **Scheduling** — You can run scripts hourly, daily, weekly, or monthly. No real-time triggers.

For advanced automation beyond these limits, check out [AdsOptimizer](https://adsoptimizer.dev) (coming soon).

## Contributing

1. Fork the repo
2. Create a feature branch
3. Test your script in Google Ads Preview mode
4. Submit a PR with description of what the script does

## License

MIT License. See [LICENSE](LICENSE).

## For Developers

### Shared Libraries

If you want to customize or extend scripts, the `lib/` folder contains reusable code:

| File | Purpose |
|------|---------|
| [utils.js](lib/utils.js) | Date formatting, number helpers |
| [sheets-helper.js](lib/sheets-helper.js) | Google Sheets read/write |
| [slack-webhook.js](lib/slack-webhook.js) | Slack notifications |

Copy functions from these files into your script as needed.

## Resources

- [Google Ads Scripts Documentation](https://developers.google.com/google-ads/scripts/docs/start)
- [Google Ads Scripts Examples](https://developers.google.com/google-ads/scripts/docs/examples)
- [Google Ads Scripts Limits](https://developers.google.com/google-ads/scripts/docs/limits)
