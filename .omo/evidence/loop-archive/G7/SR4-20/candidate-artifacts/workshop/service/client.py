import urllib.request

ENDPOINT = "http://10.0.0.9:8080/api"

def ping():
    return urllib.request.urlopen(ENDPOINT + "/ping", timeout=30).status
