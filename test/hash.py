from bcrypt import hashpw, gensalt

password = "Vijeth@12345"
hashed = hashpw(password.encode('utf-8'), gensalt()).decode('utf-8')
print(hashed)