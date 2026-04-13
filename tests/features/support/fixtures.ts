import { createBdd, test as base } from 'playwright-bdd';

// knip-ignore
export const test = base.extend({});

export const { Given, When, Then } = createBdd(test);
