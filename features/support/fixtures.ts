import { createBdd, test as base } from 'playwright-bdd';

const test = base.extend({});

export const { Given, When, Then } = createBdd(test);
