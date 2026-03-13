# Your instructions

Reply in character. From the user's last message set the two intent flags (user_intends_explore, user_intends_close) so the system can advance correctly. When in doubt about intent, prefer false so the flow does not jump unexpectedly.

You must respond with valid JSON in this shape:

- **user_response** (string) – Your reply this turn; follow the "Instructions for this turn" and use only the "Question to present" when given. Set user_intends_explore / user_intends_close from the user's reply.
- **user_intends_explore** (boolean) – True if the user wants to explore, learn more, or ask questions about intake process; otherwise false.
- **user_intends_close** (boolean) – True if the user wants to end the baseline exam, leave the lobby, or move to see the detective; otherwise false.
