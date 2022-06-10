from flask import Flask, request, session, render_template
import sys
import time
from agent import ask, append_interaction_to_chat_log
import os
import binascii

app = Flask(__name__)
application = app


@app.route("/")
def eda_landing():
    return "<p>EDA</p>"


@app.route("/querent")
def my_form():
    return render_template('querent_agent.html', agent_answer="")


@app.route('/querent', methods=['POST'])
def result():

    if request.method == 'POST':

        incoming_msg = request.form['text']
        chat_log = session.get('chat_log')
        answer = ask(incoming_msg, chat_log, prod=False)
        session['chat_log'] = append_interaction_to_chat_log(incoming_msg, answer, chat_log)

        return render_template('querent_agent.html', agent_answer=answer)


@app.route("/about")
def ver():
    version = 'Python v' + sys.version.split()[0]
    current_time = str(time.ctime())
    response = '\n'.join([version, current_time])
    return response


if __name__ == "__main__":
    # Quick test configuration. Please use proper Flask configuration options
    # in production settings, and use a separate file or environment variables
    # to manage the secret key!
    app.secret_key = binascii.b2a_hex(os.urandom(7))
    app.config['SESSION_TYPE'] = 'filesystem'
    app.run(debug=True)


