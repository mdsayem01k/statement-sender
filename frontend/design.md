# Frontend Design

## Layout

- White navigation sidebar.
- Red active navigation and primary actions.
- Neutral page background.
- Module availability cards.
- Responsive filters and tables.
- Horizontal navigation on mobile.
- Environment badge and API refresh button.

## Pages

### Overview

Display module availability, registered API route count, and background job status.

### Trade Confirmation

Report search, PDF preview, URL generation, PDF copying, individual sends, and bulk sends.

### Portfolio

Report search, PDF preview, portfolio PDF copying, individual sends, and bulk sends.

### Other Modules

Show capability information and a shortcut to filtered logs.

### Access Logs

Display audit records with date, investor, module, and event filters.

### Daily Report

Display channel totals, module summaries, error events, and CSV export.

## Files

- src/config/modules.js: module metadata and environment configuration.
- src/services/api.js: API requests, PDF URLs, audit classification, CSV export.
- src/services/operations.js: target deduplication, delivery validation, schedule validation.
- src/components/ActionToolbar.jsx: generation, PDF copying, bulk sends.
- src/App.jsx: navigation and pages.
- src/App.css: responsive presentation.

## API Mapping

| Operation | Method | Endpoint |
| --- | --- | --- |
| Route discovery | GET | /api/routes |
| Job status | GET | /api/jobs/status |
| Trade report list | GET | /api/report/urls |
| Portfolio report list | GET | /api/portfolio/urls |
| Shared logs | GET | /api/report/audit-logs or /api/portfolio/audit-logs |
| Trade notification | GET | /api/notify/trade-confirmation |
| Portfolio notification | GET | /api/notify/portfolio |
| Generate schedule URLs | GET | /api/portfoliomap/generate |
| Generate one URL | POST | /api/portfoliomap/generate |
| Copy trade PDFs | POST | /api/report/copy-pdfs |
| Copy portfolio PDFs | POST | /api/portfolio/copy-pdfs |
| Trade PDF | GET | /api/report/pdf |
| Portfolio PDF | GET | /api/report/portfolio |

## Parameters

Report lists:
- investorCode
- date
- allDates=true

Audit logs:
- clientCode
- date

Notifications:
- code
- via=mobile, email, or all

Schedule operations:
- scheduleID

Single URL generation:
- JSON body containing code

PDF access:
- BOID

## Action Handling

A synchronous lock blocks repeated notification and action requests.

Bulk sends use existing per-investor endpoints sequentially.

Stopping prevents future requests after the current investor finishes.

Failures are recorded in the bulk result table.

Copy operations follow backend current-day rules.

Report search dates do not change the copy date.

## Daily Reporting

Aggregate recorded audit events in the browser.

Statuses ending in _SENT count as sent.

FAILED, ERROR, REJECTED, INVALID, and NOT_FOUND statuses count as errors.

Successful fallback remains a sent event, with earlier channel errors shown in Details.