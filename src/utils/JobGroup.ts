import { str } from './str';

type Job = Promise<unknown>;

export default class JobGroup {
  private jobs: Set<Job> = new Set();

  constructor(jobs: Job[]) {
    for (const job of jobs) this.add(job);
  }

  add(job: Job, name?: string) {
    function errorHandler(error: unknown) {
      console.error(str`Job failed${name && `: ${name}`}`);
      console.error(error);
    }
    const removeJob = () => this.jobs.delete(thisJob);

    const thisJob: Job = job
      .catch(errorHandler)
      // .then(() => console.log(str`Job completed${name && `: ${name}`}`))
      .then(removeJob);

    this.jobs.add(thisJob);

    return removeJob;
  }

  async all(): Promise<void> {
    const ret = Promise.all(this.jobs);
    this.jobs.clear();
    await ret;
  }
}
