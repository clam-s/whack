"""Send a sample app query directly to OpenRouter and print the model reply."""

import argparse
import json
import os
import shlex
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent


def read_openrouter_config(path):
    settings = {}
    if path.is_file():
        for line in path.read_text(encoding='utf-8').splitlines():
            key, separator, value = line.strip().removeprefix('export ').partition('=')
            key = key.strip()
            if separator and key in {'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'}:
                settings[key] = ' '.join(shlex.split(value, comments=True))
    return settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('query', help='Hypothetical user query, in quotes')
    parser.add_argument('--model', help='Override OPENROUTER_MODEL')
    args = parser.parse_args()

    try:
        settings = read_openrouter_config(ROOT / '.env')
    except (OSError, ValueError):
        parser.error('Could not read OpenRouter settings from .env.')

    api_key = os.getenv('OPENROUTER_API_KEY') or settings.get('OPENROUTER_API_KEY')
    model = args.model or os.getenv('OPENROUTER_MODEL') or settings.get('OPENROUTER_MODEL')
    if not api_key:
        parser.error('Set OPENROUTER_API_KEY in .env or your environment.')
    if not model:
        parser.error('Set OPENROUTER_MODEL in .env or your environment, or pass --model.')
    if not args.query.strip():
        parser.error('The query cannot be blank.')

    mapping_path = ROOT / 'backend' / 'intent-responses.json'
    intents = json.loads(mapping_path.read_text(encoding='utf-8'))
    generate_code = intents['generate JavaScript from an instruction']
    request = Request(
        'https://openrouter.ai/api/v1/chat/completions',
        data=json.dumps({
            'model': model,
            'messages': [
                {
                    'role': 'system',
                    'content': (
                        f'Classify what the user wants to do using this intent map: {json.dumps(intents)}. '
                        'Return only JSON with responseCode (the matching code), message (one short '
                        'plain-language sentence describing the action or asking for clarification), and code. '
                        f'For {generate_code}, write a standalone JavaScript ES module for Node.js 22 '
                        'using built-in modules, no interactive input, and console.log for results. '
                        'For every other intent, set code to null.'
                    ),
                },
                {'role': 'user', 'content': args.query},
            ],
            'max_tokens': 2048,
        }).encode('utf-8'),
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urlopen(request, timeout=30) as response:
            raw_reply = response.read().decode('utf-8', errors='replace')
    except HTTPError as error:
        raw_error = error.read().decode('utf-8', errors='replace')
        if raw_error.strip():
            print(raw_error.replace(api_key, '[redacted]'), file=sys.stderr)
        parser.exit(1, f'OpenRouter returned HTTP {error.code}.\n')
    except (URLError, TimeoutError) as error:
        parser.exit(1, f'OpenRouter request failed: {error}\n')

    try:
        choice = json.loads(raw_reply)['choices'][0]
        content = choice['message'].get('content')
    except (AttributeError, KeyError, IndexError, TypeError, ValueError):
        if raw_reply.strip():
            print(raw_reply)
        parser.exit(1, 'OpenRouter returned no readable model reply.\n')

    has_text = isinstance(content, str) and bool(content.strip())
    if raw_reply.strip():
        print(content if has_text else raw_reply)
    if choice.get('finish_reason') != 'stop' or not has_text:
        parser.exit(1, f'Model reply was incomplete (finish reason: {choice.get("finish_reason")}).\n')


if __name__ == '__main__':
    main()
