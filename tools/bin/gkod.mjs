#!/usr/bin/env node
// gkod compile | check | render: the site's compiler, print checks and a picture of the part, from the command line.
import { main } from '../src/cli.ts';

process.exit(await main(process.argv.slice(2)));
