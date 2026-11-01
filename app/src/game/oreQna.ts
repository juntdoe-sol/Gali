/**
 * Hardhat Chad's ready answers, for the chat card that opens when you walk up to him on ORE Island.
 *
 * ORE facts are from Blockworks' ORE dashboard primer and QuickNode's ORE mining guide (the same sources as the
 * University lessons, ui/University.tsx). The Gali answers follow the game's own How to play.
 */
export interface Qna {
  q: string;
  a: string;
  /** a lesson in the University to read more (index into its list) */
  lesson?: number;
}

export const CHAD_ASK = 'Do you have any questions about ORE?';

export const ORE_QNA: Qna[] = [
  {
    q: 'What is ORE?',
    a: 'A token you mine on Solana. Every round, miners put SOL on a 5x5 board and one square wins. Max supply is 3 million ORE.',
    lesson: 0,
  },
  {
    q: 'How do I mine in Gali?',
    a: 'Open MINE and keep LITE: it covers all 25 spots. Tap +0.01 to start small, press DEPLOY, then claim when the round ends.',
  },
  {
    q: 'How long is a round?',
    a: '60 seconds. Then one square wins and a new round starts.',
    lesson: 0,
  },
  {
    q: 'How is the winning square picked?',
    a: 'At random by the program, one square a round. Nobody can predict it. Each square has a 1 in 25 chance.',
    lesson: 0,
  },
  {
    q: 'What happens to my SOL if I lose?',
    a: 'SOL on the 24 losing squares goes to the miners on the winning square, split by stake. Most rounds are losses, so start small.',
    lesson: 1,
  },
  {
    q: 'What do winners get?',
    a: 'The losing SOL, split by how much each winner put on the square, after a 10% fee. Plus 1 new ORE, split by stake or won whole by one miner.',
    lesson: 2,
  },
  {
    q: 'What is the Motherlode?',
    a: 'A pool that grows by 0.2 ORE every round. Each round has a 1 in 625 chance of paying all of it to the winning square.',
    lesson: 3,
  },
  {
    q: 'How many squares should I pick?',
    a: '10 to 15 squares with small amounts wins often but small. 2 to 5 squares with bigger amounts wins less often but bigger, with bigger swings.',
    lesson: 4,
  },
  {
    q: 'How much should I start with?',
    a: 'QuickNode suggests 0.5 to 1 SOL to start and 0.005 to 0.01 SOL a square while you learn. Never deploy more than you can afford to lose.',
    lesson: 5,
  },
  {
    q: 'When should I deploy?',
    a: 'Blockworks found late deployers, in the last 20+ slots of a round, had higher average P&L. Check where the SOL is piled first. Past data, no promise.',
    lesson: 6,
  },
  {
    q: 'What is an autominer?',
    a: 'A bot that deploys for you every round after one approval. Autominers place about 75% or more of the SOL each week. In Gali that is Autopilot.',
    lesson: 7,
  },
  {
    q: 'Should I claim my ORE right away?',
    a: 'Claiming costs a 10% refining fee, and that fee goes to miners who have not claimed yet. Waiting earns you a share of other miners’ fees.',
    lesson: 8,
  },
  {
    q: 'What fees are there?',
    a: '10% of the SOL on losing squares goes to the protocol, which buys back ORE. Claiming mined ORE costs a 10% refining fee, paid to unclaimed miners.',
    lesson: 1,
  },
  {
    q: 'What is staking?',
    a: 'The protocol buys ORE back with its fees. 90% is buried, like a burn, and 10% goes to stakers. Blockworks measured stORE at about 17% APY over 90 days.',
    lesson: 9,
  },
];
