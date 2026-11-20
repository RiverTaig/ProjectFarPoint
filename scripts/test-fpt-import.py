"""Local upload orchestration checks; never connects to a database."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fpt_import', Path(__file__).with_name('prepare-fpt-import.py'))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class FakeConnection:
    def __init__(self, fail_on=None):
        self.executed = []
        self.fail_on = fail_on
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def cursor(self):
        return FakeCursor(self)


class FakeCursor:
    description = None

    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def execute(self, sql, prepare):
        assert prepare is False
        self.connection.executed.append(sql)
        if sql == self.connection.fail_on:
            raise RuntimeError('Failure with private connection URI')

    def nextset(self):
        return False


class ImportTests(unittest.TestCase):
    def test_upload_orders_files_and_uses_encrypted_autocommit_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            files = [Path(directory) / name for name in ('00-setup.sql', '01-data.sql', '02-data.sql', '99-finalize.sql')]
            for file in files:
                file.write_text(file.name, encoding='utf-8')
            connection = FakeConnection()
            def connect(uri, **options):
                self.assertEqual(uri, 'postgresql://secret')
                self.assertEqual(options, {'autocommit': True, 'sslmode': 'require', 'connect_timeout': 20})
                return connection
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                importer.upload([files], 'postgresql://secret', connect)
            self.assertEqual(connection.executed, [file.name for file in files])
            self.assertTrue(connection.closed)
            self.assertNotIn('postgresql://secret', output.getvalue())

    def test_failure_stops_before_finalize_closes_connection_and_hides_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            files = [Path(directory) / name for name in ('setup', 'data', 'finalize')]
            for file in files:
                file.write_text(file.name, encoding='utf-8')
            connection = FakeConnection(fail_on='data')
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(RuntimeError) as raised:
                    importer.upload([files], 'postgresql://secret', lambda *args, **kwargs: connection)
            self.assertEqual(connection.executed, ['setup', 'data'])
            self.assertTrue(connection.closed)
            self.assertNotIn('secret', str(raised.exception))
            self.assertIn('safe to rerun', str(raised.exception))

    def test_local_credentials_file_and_environment_override(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(importer, 'ROOT', Path(directory)):
            (Path(directory) / '.env.fpt-import').write_text('SUPABASE_DB_URL="postgresql://file-value"\n', encoding='utf-8')
            with patch.dict(os.environ, {'SUPABASE_DB_URL': ''}):
                self.assertEqual(importer.database_url(), 'postgresql://file-value')
            with patch.dict(os.environ, {'SUPABASE_DB_URL': 'postgresql://environment-value'}):
                self.assertEqual(importer.database_url(), 'postgresql://environment-value')

    def test_website_url_is_rejected(self):
        with patch.dict(os.environ, {'SUPABASE_DB_URL': 'https://example.supabase.co'}):
            with self.assertRaisesRegex(RuntimeError, 'PostgreSQL connection URI'):
                importer.database_url()

    def test_generator_returns_exact_current_parts_and_preserves_disconnected_sections(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(importer, 'ROOT', Path(directory)):
            source = Path(directory) / 'FPT_3.gpx'
            source.write_text('''<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk>
<trkseg><trkpt lon="-114" lat="49"/><trkpt lon="-114" lat="49.01"/></trkseg>
<trkseg><trkpt lon="-114" lat="50"/><trkpt lon="-114" lat="50.01"/></trkseg>
</trk></gpx>''', encoding='utf-8')
            with contextlib.redirect_stdout(io.StringIO()):
                files = importer.prepare(source, 'America/Edmonton', '1')
            self.assertEqual([file.name for file in files], ['00-setup.sql', '01-data.sql', '99-finalize.sql'])
            self.assertTrue(all(file.exists() for file in files))
            import json
            feature = json.loads((files[0].parent / 'geometry.geojson').read_text())
            self.assertEqual(len(feature['geometry']['coordinates']), 2)


if __name__ == '__main__':
    unittest.main()
