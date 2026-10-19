import { act } from 'react';
import { AppCompiler, type BuildError } from '@mimicry/compiler';
import { AppRuntime } from '@mimicry/runtime';
import { createHeadlessEngine, type Session, type SessionOptions } from './session';

/**
 * Launch a real project headlessly: compile its side module with the same
 * compiler the dev server uses, link it against the in-process base, run it
 * on the virtual clock.
 */
export interface LaunchedApp {
  session: Session;
  compiler: AppCompiler;
  runtime: AppRuntime;
  buildErrors: BuildError[];
  /** recompile changed files and apply them as a hot update */
  hotReload(files?: string[]): Promise<'refreshed' | 'reload' | 'unchanged'>;
}

export async function launch(projectRoot: string, options: SessionOptions = {}): Promise<LaunchedApp> {
  const session = await createHeadlessEngine(options);
  const platform = session.engine.platform;
  const compiler = new AppCompiler({ root: projectRoot });
  const build = await compiler.build(platform);
  const clock = session.clock;
  const runtime = new AppRuntime(
    session.engine,
    {
      setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
      clearTimeout: (h) => clock.clearTimeout(h),
      setInterval: (fn, ms) => clock.setInterval(fn, ms),
      clearInterval: (h) => clock.clearInterval(h),
    },
    (fn) => act(fn),
  );
  (globalThis as any).__DEV__ = true;
  runtime.start(build.bundle);
  await session.ready();
  return {
    session,
    compiler,
    runtime,
    buildErrors: build.errors,
    async hotReload(files = []) {
      const updates = await compiler.rebuild(files);
      const update = updates.find((u) => u.platform === platform);
      if (!update?.modules.length) return 'unchanged';
      const result = runtime.hotUpdate(update.modules);
      await session.ready();
      return result;
    },
  };
}
