package ru.arseniy.move;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Arrays;

public final class UpdatePolicyTest {
    static int checks;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    interface Attempt { void run() throws Exception; }
    static void rejects(Attempt attempt,String name) throws Exception {try{attempt.run();throw new AssertionError(name);}catch(IllegalArgumentException|IOException expected){checks++;}}
    public static void main(String[] args) throws Exception {
        check(UpdatePolicy.newer("1.0.12","1.0.11"),"new patch");
        check(UpdatePolicy.newer("1.0.10","1.0.9"),"numeric comparison");
        check(UpdatePolicy.newer("2.0.0","1.99.99"),"new major");
        check(!UpdatePolicy.newer("1.0.11","1.0.11"),"same version");
        check(!UpdatePolicy.newer("1.0.10","1.0.11"),"no downgrade");
        for(String bad:new String[]{"", "v1.0.12", "1.0", "1.0.12-beta", "01.0.12", "1.-1.2", "999999.1.1", "<script>"})rejects(()->UpdatePolicy.version(bad),"invalid version");
        check("1.0.12".equals(UpdatePolicy.releaseVersion("v1.0.12")),"tag prefix");
        String asset="https://github.com/holodilow-sudo/arseniyMove/releases/download/v1.0.12/ArseniyMove-1.0.12.apk";
        check(UpdatePolicy.assetUrl(asset,"v1.0.12","ArseniyMove-1.0.12.apk"),"exact repository asset");
        for(String url:new String[]{"http://github.com/holodilow-sudo/arseniyMove/releases/download/x/a", "https://github.com.evil.test/a", "https://github.com@evil.test/a", "https://evil.test@github.com/holodilow-sudo/arseniyMove/releases/download/a", "https://127.0.0.1/a", "file:///a", "https://github.com:444/holodilow-sudo/arseniyMove/releases/download/a", "https://github.com/other/repo/releases/download/a", "https://github.com/holodilow-sudo/arseniyMove/releases/download/../a", "https://github.com/holodilow-sudo/arseniyMove/releases/download/%2e%2e/a", "https://api.github.com/user", "https://release-assets.githubusercontent.com.evil.test/a"})check(!UpdatePolicy.allowedUrl(url),"unsafe URL "+url);
        check(UpdatePolicy.allowedUrl(UpdatePolicy.API),"public release API");
        check(UpdatePolicy.allowedUrl("https://release-assets.githubusercontent.com/a?sig=x"),"GitHub asset redirect");
        check(!UpdatePolicy.assetUrl(asset,"v1.0.13","ArseniyMove-1.0.13.apk"),"wrong release URL");
        check(UpdatePolicy.sizeAllowed(54353395),"expected APK size");
        check(!UpdatePolicy.sizeAllowed(0)&&!UpdatePolicy.sizeAllowed(UpdatePolicy.MAX_APK_BYTES+1),"bounded size");
        check(UpdatePolicy.due(100,0,500),"first request");
        check(UpdatePolicy.due(100,200,500),"clock moved backwards");
        check(!UpdatePolicy.due(600,200,500),"throttle requests");
        check(UpdatePolicy.due(700,200,500),"elapsed interval");
        String[] trusted={"trusted-certificate"};
        check(UpdatePolicy.validPackage("ru.arseniy.move",13,12,"1.0.12","1.0.12",26,35,false,trusted,trusted),"valid in-place update");
        check(!UpdatePolicy.validPackage("ru.arseniy.english",13,12,"1.0.12","1.0.12",26,35,false,trusted,trusted),"reject another app");
        check(!UpdatePolicy.validPackage("ru.arseniy.move",12,12,"1.0.12","1.0.12",26,35,false,trusted,trusted),"reject same code");
        check(!UpdatePolicy.validPackage("ru.arseniy.move",11,12,"1.0.12","1.0.12",26,35,false,trusted,trusted),"reject lower code");
        check(!UpdatePolicy.validPackage("ru.arseniy.move",13,12,"1.0.13","1.0.12",26,35,false,trusted,trusted),"reject mislabeled version");
        check(!UpdatePolicy.validPackage("ru.arseniy.move",13,12,"1.0.12","1.0.12",36,35,false,trusted,trusted),"reject incompatible SDK");
        check(!UpdatePolicy.validPackage("ru.arseniy.move",13,12,"1.0.12","1.0.12",26,35,true,trusted,trusted),"reject debug APK");
        check(!UpdatePolicy.validPackage("ru.arseniy.move",13,12,"1.0.12","1.0.12",26,35,false,trusted,new String[]{"other"}),"reject foreign signer");
        check(!UpdatePolicy.matchingSignatures(new String[0],new String[0]),"reject unsigned APK");
        byte[] bytes=new byte[140000];Arrays.fill(bytes,(byte)19);
        String hash=UpdateFiles.hex(MessageDigest.getInstance("SHA-256").digest(bytes));
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        UpdateFiles.copy(new ByteArrayInputStream(bytes),out,bytes.length,hash,n->{});
        check(Arrays.equals(bytes,out.toByteArray()),"verified stream preserves full bytes");
        rejects(()->UpdateFiles.copy(new ByteArrayInputStream(bytes),new ByteArrayOutputStream(),bytes.length+1,hash,n->{}),"truncated stream");
        rejects(()->UpdateFiles.copy(new ByteArrayInputStream(bytes),new ByteArrayOutputStream(),bytes.length-1,hash,n->{}),"oversized stream");
        rejects(()->UpdateFiles.copy(new ByteArrayInputStream(bytes),new ByteArrayOutputStream(),bytes.length,"0".repeat(64),n->{}),"altered stream");
        rejects(()->UpdateFiles.copy(new ByteArrayInputStream(bytes),new ByteArrayOutputStream(),bytes.length,hash,n->{throw new IOException("cancel");}),"cancelled stream");
        rejects(()->UpdateFiles.copy(new ByteArrayInputStream(bytes),new ByteArrayOutputStream(),bytes.length,"bad",n->{}),"bad expected checksum");
        System.out.println("Update policy and download stream: "+checks+" checks PASS");
    }
}
