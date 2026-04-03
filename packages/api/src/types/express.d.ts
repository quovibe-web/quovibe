// Global Express namespace augmentation — no imports/exports so this is a global script.
// This augments the Express.Request interface which is automatically merged into
// express.Request by @types/express, making reportingPeriod visible everywhere.
declare namespace Express {
  interface Request {
    reportingPeriod: {
      start: string; // YYYY-MM-DD
      end: string;   // YYYY-MM-DD
    };
  }
}
