
import openai
import os

# openai.api_key = config.OPENAI_API_KEY
# completion = openai.Completion()
openai.api_key = os.getenv("OPENAI_API_KEY")


start_sequence = "\nAgent:"
restart_sequence = "\nQuerent:"
session_prompt = "You are talking to the Existential Detective Agency"


def ask(question, chat_log=None, prod=False):
    prompt_text = f'{chat_log}{restart_sequence}: {question}{start_sequence}:'
    if prod:
        response = openai.Completion.create(
            engine="davinci",
            prompt=prompt_text,
            temperature=0.86,
            max_tokens=150,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0.3,
            stop=["\n"],
        )
        story = response['choices'][0]['text']
        print(story)
    else:
        story = "some response here"

    return str(story)


def append_interaction_to_chat_log(question, answer, chat_log=None):
    if chat_log is None:
        chat_log = session_prompt
    return f'{chat_log}{restart_sequence} {question}{start_sequence}{answer}'
