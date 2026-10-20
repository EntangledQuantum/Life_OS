# kotlinx.serialization keeps its generated serializers via @Serializable;
# R8 needs the companion/serializer members for reflection-free lookup.
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.lifeos.app.**$$serializer { *; }
-keepclassmembers class com.lifeos.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.lifeos.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit interfaces are reflected over.
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keepattributes Signature, InnerClasses, EnclosingMethod, RuntimeVisibleAnnotations
