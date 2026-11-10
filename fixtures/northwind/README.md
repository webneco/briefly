# The Northwind fixtures

Northwind Robotics does not exist. Neither do the investors, customers, people or publications
in these articles; every URL uses the reserved `.example` domain. The articles were written for
this project so Briefly can be run and tested with no API keys and no copyrighted text.

They are built to exercise the checks:

| Article | What it tests |
| --- | --- |
| `01-about` | An undated page. Used to work out who the subject is; dropped from the news search. |
| `02` and `03` | Two sources that disagree on the size of a funding round. |
| `04` to `07` | Ordinary news: a launch, a hire, a customer deal, a safety review. |
| `08-sale-rumour-blog` | An unconfirmed rumour, with an instruction to AI assistants planted in the text. |
| `09-namesake` | A different company with a similar name. |
| `10-old-factory-news` | News from before the 30-day window. |
| `11-pune-office-paywalled` | A page that cannot be read, so only the search snippet is available. |

`npm run traps` gives these articles to a model with and without Briefly's checks, and swaps the planted instruction in `08` for five other kinds. See the main README.

`model-tape.json` holds the model's replies from one real run over these articles. `npm run demo`
replays it. `node src/cli.ts --demo --record` records it again with your own model key.
