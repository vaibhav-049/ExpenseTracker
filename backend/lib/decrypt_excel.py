import sys
import os

try:
    import msoffcrypto
except Exception as exc:
    raise RuntimeError(f"msoffcrypto import failed: {exc}")


def main():
    if len(sys.argv) < 3:
        raise RuntimeError(
            "Usage: decrypt_excel.py <input> <output>"
        )

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    password = os.environ.get("IMPORT_XLS_PASSWORD")
    if not password:
        raise RuntimeError("Missing IMPORT_XLS_PASSWORD")

    with open(input_path, "rb") as source_file:
        office_file = msoffcrypto.OfficeFile(source_file)
        office_file.load_key(password=password)

        with open(output_path, "wb") as destination_file:
            office_file.decrypt(destination_file)


if __name__ == "__main__":
    main()
