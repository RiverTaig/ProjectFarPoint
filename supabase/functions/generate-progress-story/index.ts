import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getAuthorizedUser } from '../_shared/strava.ts';

type ProjectActivity = {
  id: string;
  name: string;
  pfp_type: 'Voyager' | 'Far Point Trail' | null;
  trail_name: string | null;
  city: string | null;
  state: string | null;
  province: string | null;
  country: string | null;
  continent: string | null;
  started_at: string | null;
};

type ExistingProgressStory = {
  id: string;
  name: string;
  pfp_type: string | null;
  progress_story: string | null;
};

const stopWords = new Set([
  'about',
  'after',
  'again',
  'along',
  'also',
  'among',
  'because',
  'before',
  'between',
  'could',
  'earth',
  'every',
  'from',
  'have',
  'into',
  'like',
  'more',
  'most',
  'place',
  'point',
  'progress',
  'story',
  'that',
  'their',
  'there',
  'these',
  'this',
  'through',
  'toward',
  'under',
  'where',
  'which',
  'while',
  'with',
  'world',
  'would',
]);

function getTopKeywords(text: string, limit = 10) {
  const counts = new Map<string, number>();

  for (const word of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (stopWords.has(word)) {
      continue;
    }

    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function summarizeExistingStories(stories: ExistingProgressStory[]) {
  return stories
    .filter((story) => story.progress_story?.trim())
    .slice(0, 24)
    .map((story) => {
      const keywords = getTopKeywords(story.progress_story ?? '', 8);
      const excerpt = (story.progress_story ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 260);

      return `- ${story.name} (${story.pfp_type ?? 'route'}): keywords=${keywords.join(', ') || 'none'}; excerpt="${excerpt}"`;
    })
    .join('\n');
}

function getOutputText(data: Record<string, unknown>) {
  if (typeof data.output_text === 'string') {
    return data.output_text.trim();
  }

  const output = Array.isArray(data.output) ? data.output : [];

  return output
    .flatMap((item) => {
      const content = item && typeof item === 'object' && 'content' in item
        ? (item as { content?: unknown }).content
        : null;

      if (!Array.isArray(content)) {
        return [];
      }

      return content
        .map((contentItem) => {
          if (
            contentItem &&
            typeof contentItem === 'object' &&
            'text' in contentItem &&
            typeof (contentItem as { text?: unknown }).text === 'string'
          ) {
            return (contentItem as { text: string }).text;
          }

          return '';
        })
        .filter(Boolean);
    })
    .join('\n')
    .trim();
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  try {
    if (request.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed.' },
        { status: 405, headers },
      );
    }

    await getAuthorizedUser(request);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY');
    const openAiModel = Deno.env.get('OPENAI_PROGRESS_STORY_MODEL') ?? 'gpt-4.1';

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Supabase is not configured.');
    }

    if (!openAiApiKey) {
      throw new Error('OpenAI is not configured.');
    }

    const {
      activityId,
      latitude,
      longitude,
      progressKilometers,
      percentComplete,
      nearbyPlace,
    } = await request.json().catch(() => ({}));

    if (typeof activityId !== 'string' || !activityId) {
      return Response.json(
        { error: 'A valid activity id is required.' },
        { status: 400, headers },
      );
    }

    const progressLatitude = Number(latitude);
    const progressLongitude = Number(longitude);

    if (
      !Number.isFinite(progressLatitude) ||
      !Number.isFinite(progressLongitude) ||
      progressLatitude < -90 ||
      progressLatitude > 90 ||
      progressLongitude < -180 ||
      progressLongitude > 180
    ) {
      return Response.json(
        { error: 'A valid progress position is required.' },
        { status: 400, headers },
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data: activity, error: activityError } = await serviceClient
      .from('project_activities')
      .select('id,name,pfp_type,trail_name,city,state,province,country,continent,started_at')
      .eq('id', activityId)
      .single<ProjectActivity>();

    if (activityError) {
      throw activityError;
    }

    const { data: existingStories, error: existingStoriesError } = await serviceClient
      .from('project_activities')
      .select('id,name,pfp_type,progress_story')
      .neq('id', activityId)
      .not('progress_story', 'is', null)
      .limit(60)
      .returns<ExistingProgressStory[]>();

    if (existingStoriesError) {
      throw existingStoriesError;
    }

    const existingStoryBrief = summarizeExistingStories(existingStories ?? []);
    const roundedPercent = Number(percentComplete);
    const roundedProgressKilometers = Number(progressKilometers);
    const locationDescription = [
      `Latitude: ${progressLatitude.toFixed(5)}`,
      `Longitude: ${progressLongitude.toFixed(5)}`,
      Number.isFinite(roundedProgressKilometers)
        ? `Distance from route start: ${roundedProgressKilometers.toFixed(2)} km`
        : null,
      Number.isFinite(roundedPercent)
        ? `Percent complete: ${roundedPercent.toFixed(2)}%`
        : null,
      typeof nearbyPlace === 'string' && nearbyPlace.trim()
        ? `Nearest known place: ${nearbyPlace.trim()}`
        : null,
      `Route: ${activity.pfp_type ?? 'Project Far Point'}`,
      `Activity title: ${activity.trail_name || activity.name}`,
      activity.city || activity.province || activity.state || activity.country
        ? `Activity metadata place: ${[
          activity.city,
          activity.province || activity.state,
          activity.country,
          activity.continent,
        ].filter(Boolean).join(', ')}`
        : null,
    ].filter(Boolean).join('\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openAiModel,
        input: [
          {
            role: 'system',
            content:
              'You write reflective, literate essays for Project Far Point, a geographic storytelling project. Write with curiosity, restraint, and factual care. Do not invent named people, statistics, dates, or historical claims. If exact local facts are uncertain, broaden gracefully to the region, ocean basin, biome, route, or scientific context. Avoid travel-brochure language.',
          },
          {
            role: 'user',
            content: [
              'Write a 1-2 page essay for this progress point.',
              '',
              'Location and route context:',
              locationDescription,
              '',
              'Topic requirements:',
              '- Choose one strong, specific angle connected to this point on Earth.',
              '- Possible angles include Indigenous history, navigation, oceanography, climate, geology, biology, botany, migration, exploration, language, foodways, or a person/event connected to the region.',
              '- If the point is remote ocean, make the remoteness part of the essay and choose a scientific, ecological, or navigational angle.',
              '- Use an essayistic and reflective voice, not a listicle or encyclopedia entry.',
              '- Return only the story body. No title, markdown heading, footnotes, or citations.',
              '- Do not include image, carousel, or video markup unless the user later adds it manually.',
              '',
              existingStoryBrief
                ? [
                  'Existing progress-story fingerprints to avoid sounding repetitive:',
                  existingStoryBrief,
                  '',
                  'Pick a noticeably different subject, opening move, vocabulary, and structure from the above. If one of the obvious topics is already represented, choose a neighboring but distinct lens.',
                ].join('\n')
                : 'No existing progress stories have been saved yet, so choose the most compelling non-generic angle.',
            ].join('\n'),
          },
        ],
        temperature: 0.85,
        max_output_tokens: 1800,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        data?.error?.message ??
        `OpenAI request failed with status ${response.status}.`;
      throw new Error(message);
    }

    const story = getOutputText(data);

    if (!story) {
      throw new Error('OpenAI did not return a progress story.');
    }

    return Response.json({ story }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unexpected error.' },
      { status: 500, headers },
    );
  }
});
