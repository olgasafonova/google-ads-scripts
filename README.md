# Google Ads Scripts

Open-source Google Ads Scripts for marketers. Automate budget pacing, track quality scores, analyze Performance Max, and more.

## Scripts

| Category | Script | Description |
|----------|--------|-------------|
| **Budget Pacing** | [daily-budget-monitor.js](scripts/budget-pacing/daily-budget-monitor.js) | Alerts on daily overspend/underspend |
| | [monthly-pacing-report.js](scripts/budget-pacing/monthly-pacing-report.js) | Email summary of monthly spend vs target |
| **Quality Score** | [qs-tracker.js](scripts/quality-score/qs-tracker.js) | Daily QS snapshots to Google Sheets |
| | [qs-alert.js](scripts/quality-score/qs-alert.js) | Alert on significant QS drops |
| **Search Query Mining** | [n-gram-analyzer.js](scripts/search-query-mining/n-gram-analyzer.js) | Find patterns in search queries |
| | [negative-keyword-miner.js](scripts/search-query-mining/negative-keyword-miner.js) | Auto-suggest negative keywords |
| **Placement Exclusions** | [low-quality-detector.js](scripts/placement-exclusions/low-quality-detector.js) | Flag low-CTR placements |
| | [placement-exclusion-list.js](scripts/placement-exclusions/placement-exclusion-list.js) | Auto-exclude junk sites |
| **PMax Analysis** | [brand-overlap-detector.js](scripts/pmax-analysis/brand-overlap-detector.js) | Detect PMax/Search brand cannibalization |
| | [asset-group-performance.js](scripts/pmax-analysis/asset-group-performance.js) | Asset group performance summary |
| **Landing Page** | [status-checker.js](scripts/landing-page/status-checker.js) | Monitor 404s and slow pages |

## Quick Start

1. Open your Google Ads account
2. Go to **Tools & Settings** → **Bulk Actions** → **Scripts**
3. Click **+** → **New script**
4. Copy/paste the script you want
5. **Preview** to test, then **Run** or **Schedule**

## Configuration

Most scripts write to Google Sheets. Create a sheet and update the `CONFIG` section at the top of each script:

```javascript
const CONFIG = {
  SPREADSHEET_URL: 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit',
  EMAIL_RECIPIENTS: 'you@example.com',
  SLACK_WEBHOOK_URL: '', // Optional
};
```

## Notifications

Scripts can notify you via:
- **Email** — Built-in, just set `EMAIL_RECIPIENTS`
- **Slack** — Set `SLACK_WEBHOOK_URL` (see [lib/slack-webhook.js](lib/slack-webhook.js))
- **Google Sheets** — All scripts log to sheets by default

## Shared Libraries

Scripts in `lib/` provide common utilities:

| File | Purpose |
|------|---------|
| [utils.js](lib/utils.js) | Date formatting, number helpers |
| [sheets-helper.js](lib/sheets-helper.js) | Google Sheets read/write |
| [slack-webhook.js](lib/slack-webhook.js) | Slack notifications |

## Requirements

- Google Ads account (test account works for development)
- Basic JavaScript knowledge (for customization)
- Google Sheets (for output)

## Limitations

Google Ads Scripts have built-in limits:
- 30 minute execution time
- 50,000 entity limit per iterator
- Hourly/daily/weekly scheduling only

For advanced automation beyond these limits, check out [AdsOptimizer.com](https://adsoptimizer.com) (coming soon).

## Contributing

1. Fork the repo
2. Create a feature branch
3. Test your script in Google Ads Preview mode
4. Submit a PR with description of what the script does

## License

MIT License. See [LICENSE](LICENSE).

## Resources

- [Google Ads Scripts Documentation](https://developers.google.com/google-ads/scripts/docs/start)
- [Google Ads Scripts Examples](https://developers.google.com/google-ads/scripts/docs/examples)
- [Google Ads Scripts Limits](https://developers.google.com/google-ads/scripts/docs/limits)
