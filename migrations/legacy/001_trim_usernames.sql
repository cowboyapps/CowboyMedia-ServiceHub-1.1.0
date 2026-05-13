UPDATE users SET username = TRIM(username) WHERE username != TRIM(username);
UPDATE users SET full_name = TRIM(full_name) WHERE full_name != TRIM(full_name);
