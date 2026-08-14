import fs from 'node:fs';

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_REPOSITORY_OWNER;

if (!token) throw new Error('GITHUB_TOKEN is required');
if (!login) throw new Error('GITHUB_REPOSITORY_OWNER is required');

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(from.getUTCFullYear() - 1);

const query = `
  query ProfileStats($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      repositories(
        first: 100
        privacy: PUBLIC
        ownerAffiliations: OWNER
        isFork: false
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name } }
          }
        }
      }
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date contributionCount }
          }
        }
      }
    }
  }
`;

const apiHeaders = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'profile-stats-action'
};

const [graphResponse, eventsResponse] = await Promise.all([
  fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...apiHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { login, from: from.toISOString(), to: now.toISOString() }
    })
  }),
  fetch(`https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=20`, {
    headers: apiHeaders
  })
]);

if (!graphResponse.ok) throw new Error(`GitHub GraphQL API returned ${graphResponse.status}`);
const payload = await graphResponse.json();
if (payload.errors?.length) throw new Error(JSON.stringify(payload.errors));

const publicEvents = eventsResponse.ok ? await eventsResponse.json() : [];
const user = payload.data?.user;
if (!user) throw new Error(`Could not resolve GitHub user ${login}`);

const collection = user.contributionsCollection;
const calendar = collection.contributionCalendar;
const repoNodes = user.repositories.nodes || [];

const days = calendar.weeks
  .flatMap((week) => week.contributionDays)
  .map((day) => ({ ...day, dateObj: new Date(`${day.date}T00:00:00Z`) }))
  .filter((day) => day.dateObj >= from && day.dateObj <= now)
  .sort((a, b) => a.dateObj - b.dateObj);

const languageBytes = new Map();
for (const repo of repoNodes) {
  for (const edge of repo.languages.edges) {
    languageBytes.set(edge.node.name, (languageBytes.get(edge.node.name) || 0) + edge.size);
  }
}

const languageEntries = [...languageBytes.entries()].sort((a, b) => b[1] - a[1]);
const languageTotal = languageEntries.reduce((sum, [, bytes]) => sum + bytes, 0);
const topLanguages = languageEntries.slice(0, 6).map(([name, bytes]) => ({
  name,
  percent: languageTotal ? (bytes / languageTotal) * 100 : 0
}));

function streakStats(inputDays) {
  if (!inputDays.length) return { current: 0, longest: 0 };

  let longest = 0;
  let run = 0;
  for (const day of inputDays) {
    if (day.contributionCount > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  let i = inputDays.length - 1;
  if (inputDays[i]?.contributionCount === 0) i -= 1;

  let current = 0;
  while (i >= 0 && inputDays[i].contributionCount > 0) {
    current += 1;
    i -= 1;
  }
  return { current, longest };
}

function compact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function esc(value) {
  return String(value).replace(/[&<>\"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[ch]));
}

function shorten(value, max = 62) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function timeAgo(dateString) {
  const seconds = Math.max(0, Math.floor((now - new Date(dateString)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const daysAgo = Math.floor(hours / 24);
  if (daysAgo < 30) return `${daysAgo}d ago`;
  return new Date(dateString).toISOString().slice(0, 10);
}

function eventLine(event) {
  const repo = event.repo?.name || 'repository';
  const p = event.payload || {};

  switch (event.type) {
    case 'PushEvent': {
      const count = Array.isArray(p.commits) ? p.commits.length : Number(p.size || 0);
      const message = Array.isArray(p.commits) && p.commits.length
        ? p.commits[p.commits.length - 1]?.message
        : '';
      return {
        title: `Pushed ${count || 1} commit${count === 1 ? '' : 's'} to ${repo}`,
        detail: message ? shorten(message) : 'Updated repository code'
      };
    }
    case 'PullRequestEvent':
      return {
        title: `${String(p.action || 'updated').replace(/^./, (c) => c.toUpperCase())} pull request #${p.number || '—'}`,
        detail: repo
      };
    case 'PullRequestReviewEvent':
      return {
        title: `Reviewed pull request #${p.pull_request?.number || '—'}`,
        detail: repo
      };
    case 'IssuesEvent':
      return {
        title: `${String(p.action || 'updated').replace(/^./, (c) => c.toUpperCase())} issue #${p.issue?.number || '—'}`,
        detail: repo
      };
    case 'IssueCommentEvent':
      return {
        title: `Commented on issue #${p.issue?.number || '—'}`,
        detail: repo
      };
    case 'CreateEvent':
      return {
        title: `Created ${p.ref_type || 'item'}${p.ref ? ` ${p.ref}` : ''}`,
        detail: repo
      };
    case 'ForkEvent':
      return { title: `Forked ${repo}`, detail: p.forkee?.full_name || 'Created a fork' };
    case 'WatchEvent':
      return { title: `Starred ${repo}`, detail: 'Public GitHub activity' };
    case 'ReleaseEvent':
      return { title: `${String(p.action || 'updated')} release`, detail: repo };
    default:
      return { title: event.type?.replace(/Event$/, '') || 'GitHub activity', detail: repo };
  }
}

const { current, longest } = streakStats(days);
const totalContributions = calendar.totalContributions;
const repos = user.repositories.totalCount;
const commits = collection.totalCommitContributions;
const prs = collection.totalPullRequestContributions;
const issues = collection.totalIssueContributions;
const totalStars = repoNodes.reduce((sum, repo) => sum + repo.stargazerCount, 0);
const activeDays = days.filter((day) => day.contributionCount > 0).length;
const averagePerActiveDay = activeDays ? (totalContributions / activeDays).toFixed(1) : '0';
const topLanguage = topLanguages[0]?.name || '—';

const lastWeeks = calendar.weeks.slice(-52);
const maxCount = Math.max(1, ...lastWeeks.flatMap((week) => week.contributionDays.map((day) => day.contributionCount)));
const levels = ['#e0e0dc', '#bfbfba', '#8d8d88', '#565653', '#111111'];
const cells = [];
const cell = 10;
const gap = 4;
const originX = 86;
const originY = 362;

lastWeeks.forEach((week, x) => {
  week.contributionDays.forEach((day, y) => {
    const ratio = day.contributionCount / maxCount;
    const level = day.contributionCount === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(ratio * 4)));
    cells.push(`<rect x="${originX + x * (cell + gap)}" y="${originY + y * (cell + gap)}" width="${cell}" height="${cell}" rx="1.5" fill="${levels[level]}"/>`);
  });
});

const overview = [
  ['REPOSITORIES', compact(repos), 'public · non-fork'],
  ['COMMITS', compact(commits), 'last 12 months'],
  ['PULL REQUESTS', compact(prs), 'last 12 months'],
  ['STARS', compact(totalStars), 'public repositories'],
  ['CONTRIBUTIONS', compact(totalContributions), 'last 12 months']
];

const overviewMarkup = overview.map(([label, value, sub], i) => {
  const width = 210;
  const gap = 16;
  const x = 42 + i * (width + gap);
  return `<g transform="translate(${x} 92)">
    <rect width="${width}" height="150" rx="2" fill="#f8f8f5" stroke="#bcbcb7"/>
    <text class="label" x="18" y="29">${esc(label)}</text>
    <text class="big" x="18" y="82">${esc(value)}</text>
    <path d="M18 105H192" stroke="#d1d1cc"/>
    <text class="sub" x="18" y="128">${esc(sub)}</text>
  </g>`;
}).join('\n');

const languageMarkup = topLanguages.map((lang, i) => {
  const y = 632 + i * 36;
  const percent = Math.round(lang.percent * 10) / 10;
  const width = Math.max(0, Math.min(230, (percent / 100) * 230));
  return `<g>
    <text class="body" x="68" y="${y}">${esc(lang.name)}</text>
    <rect x="190" y="${y - 9}" width="230" height="8" rx="4" fill="#ddddD8"/>
    <rect x="190" y="${y - 9}" width="${width}" height="8" rx="4" fill="#1b1b1b"/>
    <text class="sub" x="442" y="${y}" text-anchor="end">${percent}%</text>
  </g>`;
}).join('\n');

const recent = Array.isArray(publicEvents) ? publicEvents.slice(0, 5) : [];
const recentMarkup = recent.length
  ? recent.map((event, i) => {
      const y = 627 + i * 47;
      const line = eventLine(event);
      return `<g>
        <circle cx="548" cy="${y - 4}" r="4" fill="#f4f4f1" stroke="#222"/>
        ${i < recent.length - 1 ? `<path d="M548 ${y}V${y + 43}" stroke="#bdbdb8"/>` : ''}
        <text class="body" x="570" y="${y}">${esc(shorten(line.title, 58))}</text>
        <text class="sub" x="570" y="${y + 19}">${esc(shorten(line.detail, 66))}</text>
        <text class="sub" x="1125" y="${y}" text-anchor="end">${esc(timeAgo(event.created_at))}</text>
      </g>`;
    }).join('\n')
  : `<text class="sub" x="548" y="650">No recent public activity available.</text>`;

const bottomStats = [
  ['CURRENT STREAK', `${current}d`, 'consecutive days'],
  ['LONGEST STREAK', `${longest}d`, 'within last 12m'],
  ['ACTIVE DAYS', compact(activeDays), 'within last 12m'],
  ['ISSUES', compact(issues), 'last 12 months'],
  ['AVG / ACTIVE DAY', averagePerActiveDay, 'contributions']
];

const bottomMarkup = bottomStats.map(([label, value, sub], i) => {
  const x = 42 + i * 226;
  return `<g transform="translate(${x} 875)">
    <text class="label" y="0">${esc(label)}</text>
    <text class="smallBig" y="42">${esc(value)}</text>
    <text class="sub" y="66">${esc(sub)}</text>
  </g>`;
}).join('\n');

const updated = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1010" viewBox="0 0 1200 1010" role="img" aria-labelledby="title desc">
<title id="title">Live GitHub activity dashboard</title>
<desc id="desc">Automatically generated public GitHub repository, contribution, commit, pull request, star, streak, language and recent activity statistics.</desc>
<style>
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .label { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; letter-spacing: 1px; fill: #20201e; }
  .sub { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; fill: #747470; }
  .body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; fill: #30302e; }
  .big { font-family: Arial, Helvetica, sans-serif; font-size: 37px; font-weight: 700; fill: #0e0e0d; }
  .smallBig { font-family: Arial, Helvetica, sans-serif; font-size: 29px; font-weight: 700; fill: #0e0e0d; }
  .title { font-family: Arial, Helvetica, sans-serif; font-size: 46px; font-weight: 800; fill: #0e0e0d; letter-spacing: 2px; }
  .card { fill: #f8f8f5; stroke: #bcbcb7; stroke-width: 1; }
</style>
<rect width="1200" height="1010" fill="#f4f4f1"/>
<path d="M42 38H1158" stroke="#777773"/>
<circle cx="42" cy="61" r="4" fill="#111"/>
<text class="label" x="60" y="65">ACTIVITY / LIVE</text>
<text class="sub" x="1158" y="65" text-anchor="end">${esc(updated)}</text>
${overviewMarkup}

<rect class="card" x="42" y="265" width="1116" height="270" rx="2"/>
<text class="label" x="66" y="298">CONTRIBUTIONS / LAST 52 WEEKS</text>
<text class="sub" x="66" y="319">${compact(totalContributions)} contributions in the last 12 months</text>
<text class="sub" x="54" y="377">MON</text>
<text class="sub" x="54" y="405">WED</text>
<text class="sub" x="54" y="433">FRI</text>
${cells.join('\n')}
<g class="sub">
  <text x="860" y="486">LESS</text>
  <rect x="900" y="478" width="10" height="10" rx="1" fill="#e0e0dc"/>
  <rect x="916" y="478" width="10" height="10" rx="1" fill="#bfbfba"/>
  <rect x="932" y="478" width="10" height="10" rx="1" fill="#8d8d88"/>
  <rect x="948" y="478" width="10" height="10" rx="1" fill="#565653"/>
  <rect x="964" y="478" width="10" height="10" rx="1" fill="#111111"/>
  <text x="982" y="486">MORE</text>
</g>

<rect class="card" x="42" y="558" width="448" height="286" rx="2"/>
<text class="label" x="68" y="590">TOP LANGUAGES</text>
<text class="sub" x="442" y="590" text-anchor="end">public repository bytes</text>
${languageMarkup}

<rect class="card" x="512" y="558" width="646" height="286" rx="2"/>
<text class="label" x="538" y="590">RECENT PUBLIC ACTIVITY</text>
${recentMarkup}

<path d="M42 856H1158" stroke="#bcbcb7"/>
${bottomMarkup}
<path d="M42 970H1158" stroke="#777773"/>
<text class="sub" x="42" y="992">TOP LANGUAGE · ${esc(topLanguage)}</text>
<text class="sub" x="1158" y="992" text-anchor="end">source: GitHub GraphQL + public events API</text>
</svg>`;

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/profile-stats.svg', svg);
console.log(`Generated assets/profile-stats.svg for ${login}`);
