# AI review status

AI review is currently disabled in the application. The desktop package does not include or start a local inference engine and does not download Qwen model weights. Any Qwen cache already present under the user's local application data is left untouched.

Revisit review after a clinic-hosted network service is available. Workstations should send only the report body after removing study number, patient name, date of birth, physician name, report date, and footer text. The service should stay on the clinic network, authenticate clients, use TLS, and avoid storing reports or prompts. Empty fields and unchanged template content should be reported locally without invoking an LLM.
