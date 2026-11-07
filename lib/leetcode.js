// Fetches a public LeetCode profile through LeetCode's GraphQL endpoint
// and normalizes it into one compact object the dashboard and coach use.
// Each query runs on its own, so one changed field on LeetCode's side
// only blanks one section instead of breaking the whole profile.

import { HttpError } from './http.js';

const ENDPOINT = 'https://leetcode.com/graphql';
const ORIGIN = 'https://leetcode.com';
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

export const USERNAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;

const Q = {
  profile: `query profile($username: String!) {
    allQuestionsCount { difficulty count }
    matchedUser(username: $username) {
      username githubUrl twitterUrl linkedinUrl
      profile { realName userAvatar ranking reputation countryName company school aboutMe skillTags }
      submitStats {
        acSubmissionNum { difficulty count submissions }
        totalSubmissionNum { difficulty count submissions }
      }
      badges { id displayName icon creationDate }
    }
  }`,
  calendar: `query calendar($username: String!) {
    matchedUser(username: $username) {
      userCalendar { activeYears streak totalActiveDays submissionCalendar }
    }
  }`,
  skills: `query skills($username: String!) {
    matchedUser(username: $username) {
      languageProblemCount { languageName problemsSolved }
      tagProblemCounts {
        advanced { tagName tagSlug problemsSolved }
        intermediate { tagName tagSlug problemsSolved }
        fundamental { tagName tagSlug problemsSolved }
      }
    }
  }`,
  contest: `query contest($username: String!) {
    userContestRanking(username: $username) {
      attendedContestsCount rating globalRanking totalParticipants topPercentage
      badge { name }
    }
    userContestRankingHistory(username: $username) {
      attended rating ranking problemsSolved totalProblems
      contest { title startTime }
    }
  }`,
  recent: `query recent($username: String!) {
    recentAcSubmissionList(username: $username, limit: 20) { id title titleSlug timestamp lang }
  }`,
  beats: `query beats($username: String!) {
    userProfileUserQuestionProgressV2(userSlug: $username) {
      userSessionBeatsPercentage { difficulty percentage }
    }
  }`,
};

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: `${ORIGIN}/`,
      Origin: ORIGIN,
      'User-Agent': 'Mozilla/5.0 (compatible; LeetLens/1.0)',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 429) throw new HttpError(429, 'LeetCode is rate limiting requests. Try again in a minute.');
  if (!res.ok) throw new Error(`LeetCode responded ${res.status}`);
  const json = await res.json();
  if (!json.data) throw new Error(json.errors?.[0]?.message || 'Empty GraphQL response');
  return json.data;
}

const abs = (url) => (!url ? null : url.startsWith('http') ? url : `${ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`);

function byDifficulty(list = [], field = 'count') {
  const out = { all: 0, easy: 0, medium: 0, hard: 0 };
  for (const row of list) out[String(row.difficulty).toLowerCase()] = row[field] ?? 0;
  return out;
}

export async function getProfile(rawUsername) {
  const username = String(rawUsername || '').trim();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'That does not look like a LeetCode username.');

  const key = username.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const vars = { username };
  const names = Object.keys(Q);
  const settled = await Promise.allSettled(names.map((n) => gql(Q[n], vars)));
  const r = Object.fromEntries(names.map((n, i) => [n, settled[i].status === 'fulfilled' ? settled[i].value : null]));

  const rateLimited = settled.find((s) => s.status === 'rejected' && s.reason?.status === 429);
  if (!r.profile) {
    if (rateLimited) throw rateLimited.reason;
    throw new HttpError(502, 'Could not reach LeetCode right now. Try again shortly.');
  }
  const u = r.profile.matchedUser;
  if (!u) throw new HttpError(404, `No LeetCode user called "${username}".`);

  const p = u.profile || {};
  const ac = u.submitStats?.acSubmissionNum || [];
  const tot = u.submitStats?.totalSubmissionNum || [];
  const cal = r.calendar?.matchedUser?.userCalendar;
  const skills = r.skills?.matchedUser;
  const cr = r.contest?.userContestRanking;
  const history = (r.contest?.userContestRankingHistory || []).filter((h) => h.attended);

  let calendarMap = {};
  try { calendarMap = cal?.submissionCalendar ? JSON.parse(cal.submissionCalendar) : {}; } catch { calendarMap = {}; }

  const tagList = (arr = []) =>
    arr.map((t) => ({ name: t.tagName, slug: t.tagSlug, solved: t.problemsSolved })).filter((t) => t.solved > 0);

  const beatsRaw = r.beats?.userProfileUserQuestionProgressV2?.userSessionBeatsPercentage;
  const beats = beatsRaw ? byDifficulty(beatsRaw, 'percentage') : null;

  const data = {
    username: u.username,
    fetchedAt: new Date().toISOString(),
    profile: {
      realName: p.realName || '',
      avatar: abs(p.userAvatar),
      ranking: p.ranking || null,
      reputation: p.reputation || 0,
      country: p.countryName || '',
      company: p.company || '',
      school: p.school || '',
      about: (p.aboutMe || '').slice(0, 400),
      skillTags: p.skillTags || [],
      github: u.githubUrl || '',
      linkedin: u.linkedinUrl || '',
      twitter: u.twitterUrl || '',
    },
    solved: byDifficulty(ac, 'count'),
    totals: byDifficulty(r.profile.allQuestionsCount, 'count'),
    submissions: {
      accepted: ac.find((x) => x.difficulty === 'All')?.submissions ?? 0,
      total: tot.find((x) => x.difficulty === 'All')?.submissions ?? 0,
    },
    beats,
    calendar: {
      map: calendarMap,
      streak: cal?.streak ?? null,
      totalActiveDays: cal?.totalActiveDays ?? null,
      activeYears: cal?.activeYears || [],
    },
    languages: (skills?.languageProblemCount || [])
      .map((l) => ({ name: l.languageName, solved: l.problemsSolved }))
      .filter((l) => l.solved > 0)
      .sort((a, b) => b.solved - a.solved),
    tags: skills?.tagProblemCounts
      ? {
          fundamental: tagList(skills.tagProblemCounts.fundamental),
          intermediate: tagList(skills.tagProblemCounts.intermediate),
          advanced: tagList(skills.tagProblemCounts.advanced),
        }
      : null,
    contest: cr || history.length
      ? {
          attended: cr?.attendedContestsCount ?? history.length,
          rating: cr?.rating ? Math.round(cr.rating) : null,
          globalRanking: cr?.globalRanking ?? null,
          totalParticipants: cr?.totalParticipants ?? null,
          topPercentage: cr?.topPercentage ?? null,
          badge: cr?.badge?.name || null,
          history: history.map((h) => ({
            title: h.contest?.title || 'Contest',
            time: h.contest?.startTime ?? null,
            rating: Math.round(h.rating),
            ranking: h.ranking,
            solved: h.problemsSolved,
            total: h.totalProblems,
          })),
        }
      : null,
    recent: (r.recent?.recentAcSubmissionList || []).map((s) => ({
      title: s.title,
      slug: s.titleSlug,
      time: Number(s.timestamp),
      lang: s.lang,
    })),
    badges: (u.badges || []).map((b) => ({ name: b.displayName, icon: abs(b.icon), date: b.creationDate })),
    partial: names.filter((n) => !r[n]),
  };

  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}
