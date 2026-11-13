"""MQTT Bridge: Multi-threaded TCP forwarder from Wi-Fi IP:1883 to 127.0.0.1:1883."""

import socket
import sys
import threading


def pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(4096)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        try:
            src.close()
        except Exception:
            pass
        try:
            dst.close()
        except Exception:
            pass


def handle_client(client_sock: socket.socket, client_addr: tuple, target_ip: str, target_port: int) -> None:
    try:
        target_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        target_sock.settimeout(5.0)
        target_sock.connect((target_ip, target_port))
        target_sock.settimeout(None)
        client_sock.settimeout(None)
        print(f"[BRIDGE] ESP32 Terhubung dari {client_addr} -> {target_ip}:{target_port}")
    except Exception as ex:
        print(f"[BRIDGE] Gagal menyambung ke Mosquitto: {ex}")
        try:
            client_sock.close()
        except Exception:
            pass
        return

    t1 = threading.Thread(target=pipe, args=(client_sock, target_sock), daemon=True)
    t2 = threading.Thread(target=pipe, args=(target_sock, client_sock), daemon=True)
    t1.start()
    t2.start()


def main() -> None:
    listen_ip = sys.argv[1] if len(sys.argv) > 1 else "0.0.0.0"
    listen_port = 1883
    target_ip = "127.0.0.1"
    target_port = 1883

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind((listen_ip, listen_port))
    except Exception as e:
        print(f"[BRIDGE ERROR] Gagal bind ke {listen_ip}:{listen_port} - {e}")
        return

    server.listen(20)
    print(f"[BRIDGE] Mendengarkan koneksi di {listen_ip}:{listen_port} -> Meneruskan ke {target_ip}:{target_port}")

    while True:
        try:
            client_sock, client_addr = server.accept()
            threading.Thread(
                target=handle_client,
                args=(client_sock, client_addr, target_ip, target_port),
                daemon=True,
            ).start()
        except Exception as e:
            print(f"[BRIDGE] Accept error: {e}")


if __name__ == "__main__":
    main()

