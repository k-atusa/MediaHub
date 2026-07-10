package com.example.k7mediahub.view;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.example.k7mediahub.MHcore;
import com.example.k7mediahub.R;
import com.example.k7mediahub.SVCC1;
import com.example.k7mediahub.app.SvcMH;

// User login activity
public class LoginView extends AppCompatActivity {
    private EditText eUrl, eName, ePw;
    private CheckBox cTls;
    private TextView tStat;
    private Button bLog;

    // Standard lifecycle
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setContentView(R.layout.activity_login);

        eUrl = findViewById(R.id.edtServerUrl);
        eName = findViewById(R.id.edtUsername);
        ePw = findViewById(R.id.edtPassword);
        cTls = findViewById(R.id.chkTls);
        tStat = findViewById(R.id.txtStatus);
        bLog = findViewById(R.id.btnLogin);

        // Req permission
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
        }

        // Load saved config
        try {
            MHcore c = new MHcore(false);
            c.LoadCfg(this);
            eUrl.setText(c.srvUrl);
            eName.setText(c.uName);
        } catch (Exception ignored) {}

        // Handle login result
        SVCC1.getChan().ToMainBus.observe(this, ev -> {
            if (ev == null) return;
            bLog.setEnabled(true);
            switch (ev.action) {
                case "LOGIN_OK":
                    startActivity(new Intent(this, FolderView.class));
                    finish();
                    break;
                case "LOGIN_FAIL":
                    Bundle d = (Bundle) ev.data;
                    tStat.setText(d.getString("msg", "Fail"));
                    break;
            }
        });

        // Trigger login
        bLog.setOnClickListener(v -> {
            String url = eUrl.getText().toString().trim();
            String name = eName.getText().toString().trim();
            String pw = ePw.getText().toString();

            if (url.isEmpty() || name.isEmpty() || pw.isEmpty()) {
                tStat.setText("Check Inputs");
                return;
            }

            bLog.setEnabled(false);
            tStat.setText("Connecting...");

            startSvc();

            Bundle req = new Bundle();
            req.putString("url", url);
            req.putString("name", name);
            req.putString("pw", pw);
            req.putBoolean("ignTLS", cTls.isChecked());
            SVCC1.getChan().SendToSvc("LOGIN", req);
        });
    }

    // Ensure service is running
    private void startSvc() {
        Intent it = new Intent(this, SvcMH.class);
        startForegroundService(it);
    }
}
