// Lets Node's built-in test runner import the app's plain .js modules, which
// use Vite-style extensionless imports ("./constants"). No extra packages.
// Used by `npm test`: node --import ./tests/register.mjs --test ...
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') && !/\\.[a-z]+$/i.test(specifier)) return next(specifier + '.js', context);
    throw error;
  }
}
`));
