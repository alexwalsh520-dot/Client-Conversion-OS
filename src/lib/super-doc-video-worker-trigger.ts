import { getVideoJob, updateVideoJob } from './super-doc-video-automation';

function clean(value?: string | null) {
  return (value || '').trim();
}

function githubRepo() {
  return (
    clean(process.env.GITHUB_VIDEO_WORKER_REPOSITORY) ||
    clean(process.env.GITHUB_REPOSITORY) ||
    'alexwalsh520-dot/Client-Conversion-OS'
  );
}

function githubToken() {
  return clean(process.env.GITHUB_VIDEO_WORKER_TOKEN);
}

export interface VideoWorkerTriggerResult {
  triggered: boolean;
  provider: 'github_actions';
  repository: string;
  missingEnv?: string;
  error?: string;
}

export async function triggerVideoWorkerForJob(jobId: string): Promise<VideoWorkerTriggerResult> {
  const repository = githubRepo();
  const token = githubToken();
  const job = await getVideoJob(jobId);

  if (!job) {
    return {
      triggered: false,
      provider: 'github_actions',
      repository,
      error: 'Video job not found',
    };
  }

  if (!token) {
    await updateVideoJob(jobId, {
      metadata: {
        ...(job.metadata || {}),
        worker_trigger_missing_env: 'GITHUB_VIDEO_WORKER_TOKEN',
        worker_trigger_attempted_at: new Date().toISOString(),
      },
    }).catch(() => {});

    return {
      triggered: false,
      provider: 'github_actions',
      repository,
      missingEnv: 'GITHUB_VIDEO_WORKER_TOKEN',
    };
  }

  const res = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: 'super-doc-video-worker',
      client_payload: {
        job_id: jobId,
        run_id: job.run_id,
        lead_slug: job.lead_slug,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    const message = `GitHub worker trigger failed (${res.status}): ${text.slice(0, 500)}`;
    await updateVideoJob(jobId, {
      metadata: {
        ...(job.metadata || {}),
        worker_trigger_failed_at: new Date().toISOString(),
        worker_trigger_error: message,
      },
    }).catch(() => {});

    return {
      triggered: false,
      provider: 'github_actions',
      repository,
      error: message,
    };
  }

  await updateVideoJob(jobId, {
    metadata: {
      ...(job.metadata || {}),
      worker_triggered_at: new Date().toISOString(),
      worker_provider: 'github_actions',
      worker_repository: repository,
    },
  });

  return {
    triggered: true,
    provider: 'github_actions',
    repository,
  };
}
